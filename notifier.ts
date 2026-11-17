import type { BotEvent, BotState, ClosedTrade } from '../../engine/src/types';
import type { BotRow, SqlRepo } from './repo';
import type { Runner } from './runner';
type L = 'he' | 'en';
const usd = (c: number) => `${c < 0 ? '-' : c > 0 ? '+' : ''}$${(Math.abs(c) / 100).toFixed(2)}`;
const px = (p4?: number) => (p4 === undefined ? '' : `$${(p4 / 10000).toFixed(2)}`);
const T = {
  he: { started: 'הבוט הופעל (דמו)', entry: 'תנאי הכניסה התקיימו', opened: 'עסקה וירטואלית נפתחה', tp: 'יעד הרווח הושג', sl: 'מגבלת ההפסד הופעלה', closed: 'עסקה וירטואלית נסגרה',
    disc: 'חיבור נתוני השוק נותק', recon: 'חיבור נתוני השוק חודש', stale: 'נתוני שוק לא מתעדכנים - הבוט הושהה' },
  en: { started: 'Bot started (demo)', entry: 'Entry conditions met', opened: 'Virtual trade opened', tp: 'Take profit reached', sl: 'Stop loss triggered', closed: 'Virtual trade closed',
    disc: 'Market data disconnected', recon: 'Market data reconnected', stale: 'Market data stale - bot paused' } };

/** Builds the notification text for one engine event. Closed-trade details come from the exact k-th closed trade (events and trades are appended in the same order). */
export function compose(bot: BotRow, state: BotState, e: BotEvent, index: number, lang: L): { title: string; body: string } | null {
  const t = T[lang], sym = bot.config.symbol;
  switch (e.type) {
    case 'BOT_STARTED': return { title: t.started, body: sym };
    case 'ENTRY_CONDITION_MET': return { title: t.entry, body: `${sym} ${px(e.price4)}` };
    case 'POSITION_OPENED': { const q = /Bought (\d+)/.exec(e.message)?.[1]; return { title: t.opened, body: `${sym} ${q ? q + ' @ ' : ''}${px(e.price4)}` }; }
    case 'POSITION_CLOSED': {
      const k = state.events.slice(0, index).filter(x => x.type === 'POSITION_CLOSED').length; const tr: ClosedTrade | undefined = state.closed[k];
      if (!tr) return { title: t.closed, body: sym };
      const title = tr.reason === 'TAKE_PROFIT' ? t.tp : tr.reason === 'STOP_LOSS' ? t.sl : t.closed;
      return { title, body: `${sym} ${px(tr.exitPrice4)} · ${usd(tr.netPnlCents)}` };
    }
    case 'DATA_DISCONNECTED': return { title: t.disc, body: sym };
    case 'DATA_RECONNECTED': return { title: t.recon, body: sym };
    case 'DATA_STALE': return { title: t.stale, body: sym };
    default: return null;                                   // BOT_STOPPED, ENTRY_SKIPPED, ... are in the log but not pushed
  }
}
export class Notifier {
  constructor(private o: { repo: SqlRepo; endpoint?: string; fetchFn?: typeof fetch }) {}
  attach(runner: Runner) { runner.listeners.add((id, e, i) => this.onEvent(id, e, i).catch(err => console.error('push failed', String(err)))); }
  async onEvent(botId: string, e: BotEvent, index: number) {
    const bot = await this.o.repo.get(botId); if (!bot) return; const toks = await this.o.repo.pushTokens(bot.userId); if (!toks.length) return;
    const msgs = toks.flatMap(({ token, lang }) => { const c = compose(bot, bot.state, e, index, lang === 'en' ? 'en' : 'he');
      return c ? [{ to: token, title: c.title, body: c.body, sound: 'default', data: { botId, type: e.type } }] : []; });
    const f = this.o.fetchFn ?? fetch;
    for (let i = 0; i < msgs.length; i += 100) {                                               // Expo accepts at most 100 messages per request
      const chunk = msgs.slice(i, i + 100);
      const r = await f(this.o.endpoint ?? 'https://exp.host/--/api/v2/push/send', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(chunk) });
      if (!r.ok) { console.error('push http', r.status); continue; }
      const tickets: any[] = ((await r.json().catch(() => ({}))) as any).data ?? [];
      for (let j = 0; j < tickets.length; j++) if (tickets[j]?.status === 'error' && tickets[j]?.details?.error === 'DeviceNotRegistered') await this.o.repo.removePushToken(chunk[j].to);
    }
  }
}
