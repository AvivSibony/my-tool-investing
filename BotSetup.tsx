import React, { useState } from 'react';
import { ScrollView, View, Text, Modal, Alert } from 'react-native';
import { useApp } from '../state'; import { t, isRTL } from '../i18n'; import { emptyDraft, toPayload, summary, Draft, Errors } from '../draft';
import { Btn, Field, PaperBadge, Card, Row, st, align } from '../ui'; import { C } from '../theme';

export default function BotSetup() {
  const { cfg, save, api, pf } = useApp(); const l = cfg.lang; const [d, setD] = useState<Draft>(emptyDraft());
  const [errs, setErrs] = useState<Errors>({}); const [payload, setPayload] = useState<any>(null); const [busy, setBusy] = useState(false);
  const set = (k: keyof Draft) => (v: string) => setD({ ...d, [k]: v });
  const review = () => { const r = toPayload(d); if (r.ok) { setErrs({}); setPayload(r.payload); } else setErrs(r.errors); };
  const launch = async () => {
    if (!api) return; setBusy(true);
    try { const { id } = await api.createBot(payload); await api.start(id); await save({ botId: id }); setPayload(null); }
    catch (e: any) { Alert.alert('Error', JSON.stringify(e?.body?.errors ?? e?.message ?? e)); } finally { setBusy(false); }
  };
  const e = (k: keyof Draft) => (errs[k] ? t(l, errs[k]!) : undefined);
  const dir = { direction: isRTL(l) ? ('rtl' as const) : ('ltr' as const) };
  return (<ScrollView style={st.screen} contentContainerStyle={st.pad}>
    <PaperBadge lang={l} />
    <Field label={t(l, 'symbol')} value={d.symbol} onChangeText={set('symbol')} autoCapitalize="characters" error={e('symbol')} />
    <Field label={t(l, 'budget')} value={d.budget} onChangeText={set('budget')} keyboardType="decimal-pad" error={e('budget')} />
    <Text style={st.muted}>{t(l, 'trigger')}</Text>
    <View style={{ flexDirection: isRTL(l) ? 'row-reverse' : 'row', gap: 8, marginVertical: 8 }}>
      {(['price_at', 'above', 'below'] as const).map(k => <View key={k} style={{ flex: 1 }}><Btn kind={d.trigger === k ? 'primary' : 'ghost'} title={t(l, `trig_${k}` as any)} onPress={() => setD({ ...d, trigger: k })} /></View>)}
    </View>
    <Field label={t(l, 'entry_price')} value={d.entryPrice} onChangeText={set('entryPrice')} keyboardType="decimal-pad" error={e('entryPrice')} />
    <Field label={t(l, 'rsi')} value={d.rsi} onChangeText={set('rsi')} keyboardType="decimal-pad" error={e('rsi')} />
    <Field label={t(l, 'tp')} value={d.tp} onChangeText={set('tp')} keyboardType="decimal-pad" error={e('tp')} />
    <Field label={t(l, 'sl')} value={d.sl} onChangeText={set('sl')} keyboardType="decimal-pad" error={e('sl')} />
    <Field label={t(l, 'trail')} value={d.trail} onChangeText={set('trail')} keyboardType="decimal-pad" error={e('trail')} />
    <Field label={t(l, 'hold')} value={d.holdMin} onChangeText={set('holdMin')} keyboardType="number-pad" error={e('holdMin')} />
    <Field label={t(l, 'fee')} value={d.fee} onChangeText={set('fee')} keyboardType="number-pad" error={e('fee')} />
    <Field label={t(l, 'slip')} value={d.slip} onChangeText={set('slip')} keyboardType="number-pad" error={e('slip')} />
    <Field label={t(l, 'maxpos')} value={d.maxOpen} onChangeText={set('maxOpen')} keyboardType="number-pad" error={e('maxOpen')} />
    <Btn title={t(l, 'review')} onPress={review} disabled={!api} />
    {cfg.botId && pf ? <Btn kind="danger" title={pf.status === 'stopped' ? t(l, 'start_bot') : t(l, 'stop_bot')}
      onPress={() => (pf.status === 'stopped' ? api!.start(cfg.botId) : api!.stop(cfg.botId))} /> : null}
    <Modal visible={!!payload} transparent animationType="slide" onRequestClose={() => setPayload(null)}>
      <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: '#000A' }}><View style={[st.card, { marginBottom: 0, borderBottomLeftRadius: 0, borderBottomRightRadius: 0 }, dir]}>
        <Text style={[st.h1, { fontSize: 20 }, align(l)]}>{t(l, 'confirm_title')}</Text><PaperBadge lang={l} />
        {payload && summary(payload, l).map(([k, v]) => <Row key={k} k={k} v={v} />)}
        <Btn title={t(l, 'confirm_btn')} onPress={launch} disabled={busy} /><Btn kind="ghost" title={t(l, 'cancel')} onPress={() => setPayload(null)} />
      </View></View></Modal>
  </ScrollView>);
}
