import React, { createContext, useContext, useEffect, useMemo, useState, useCallback } from 'react';
import * as SecureStore from 'expo-secure-store';
import { Api, Portfolio, BotEvent, Market } from './api';
import type { Lang } from './i18n';
import { registerForPush } from './push';

interface Cfg { baseUrl: string; token: string; botId: string; lang: Lang; pushToken?: string }
const DEF: Cfg = { baseUrl: 'http://localhost:3000', token: '', botId: '', lang: 'he' };
interface Ctx { cfg: Cfg; save(p: Partial<Cfg>): Promise<void>; api: Api | null; pf: Portfolio | null; mk: Market | null; events: BotEvent[]; series: { px: number[]; eq: number[] }; live: boolean; error: string | null }
const C = createContext<Ctx>(null as any);
export const useApp = () => useContext(C);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [cfg, setCfg] = useState<Cfg>(DEF); const [pf, setPf] = useState<Portfolio | null>(null);
  const [mk, setMk] = useState<Market | null>(null); const [events, setEvents] = useState<BotEvent[]>([]); const [series, setSeries] = useState({ px: [] as number[], eq: [] as number[] });
  const [live, setLive] = useState(false); const [error, setError] = useState<string | null>(null);
  useEffect(() => { SecureStore.getItemAsync('cfg').then(v => v && setCfg({ ...DEF, ...JSON.parse(v) })); }, []);
  const save = useCallback(async (p: Partial<Cfg>) => { const n = { ...cfg, ...p }; setCfg(n); await SecureStore.setItemAsync('cfg', JSON.stringify(n)); }, [cfg]);
  const api = useMemo(() => (cfg.token ? new Api(cfg.baseUrl, cfg.token) : null), [cfg.baseUrl, cfg.token]);

  useEffect(() => { if (api) registerForPush(api, cfg.lang).then(tk => tk && tk !== cfg.pushToken && save({ pushToken: tk })).catch(() => {}); }, [api, cfg.lang]);   // best effort; never blocks the app
  useEffect(() => {                                   // poll portfolio; chart series are built from real polled values only
    if (!api || !cfg.botId) return; let off = false;
    const tick = async () => { try { const [p, m] = await Promise.all([api.portfolio(cfg.botId), api.market(cfg.botId)]); if (off) return; setPf(p); setMk(m); setError(null);
      setSeries(s => ({ px: p.data.lastPrice4 == null ? s.px : [...s.px, p.data.lastPrice4].slice(-200), eq: [...s.eq, p.equityCents].slice(-200) })); }
      catch (e: any) { if (!off) { setError(String(e?.message ?? e)); if (e?.status === 401) save({ token: '', botId: '' }); } } };
    tick(); const id = setInterval(tick, 3000); return () => { off = true; clearInterval(id); };
  }, [api, cfg.botId, save]);
  useEffect(() => {                                   // initial log + live stream
    if (!api || !cfg.botId) return; let off = false;
    api.events(cfg.botId).then(r => !off && setEvents(r.events)).catch(() => {});
    const stop = api.stream(m => m.botId === cfg.botId && setEvents(e => [...e, m.event]), setLive);
    return () => { off = true; stop(); };
  }, [api, cfg.botId]);
  return <C.Provider value={{ cfg, save, api, pf, mk, events, series, live, error }}>{children}</C.Provider>;
}
