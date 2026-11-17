import React from 'react';
import { ScrollView, Text } from 'react-native';
import { useApp } from '../state'; import { t } from '../i18n'; import { fmtPrice4, fmtTime, ltr } from '../format';
import { Card, Row, LineChart, PaperBadge, st } from '../ui'; import { C } from '../theme';

export default function Market() {
  const { cfg, mk } = useApp(); const l = cfg.lang;
  if (!mk) return <ScrollView style={st.screen} contentContainerStyle={st.pad}><Text style={st.muted}>{t(l, 'no_bot')}</Text></ScrollView>;
  const q = mk.quote; const demo = mk.freshness === 'DEMO'; const ind = q?.indicators;
  return (<ScrollView style={st.screen} contentContainerStyle={st.pad}>
    {demo ? <PaperBadge lang={l} /> : null}
    <Card><Text style={st.muted}>{q ? ltr(q.symbol) : ''} · {t(l, 'last_price')}</Text>
      <Text style={st.h1}>{q ? fmtPrice4(q.session.last) : t(l, 'no_quote')}</Text>
      {q ? <LineChart data={q.bars.map(b => b.c)} /> : null}</Card>
    <Card><Row k={t(l, 'source')} v={mk.source} /><Row k={t(l, 'freshness')} v={t(l, `fresh_${mk.freshness}` as any)} color={demo ? C.demo : undefined} />
      <Row k={t(l, 'last_update')} v={q ? fmtTime(q.session.lastTs) : '—'} /></Card>
    {q ? <Card><Row k={t(l, 'open_px')} v={fmtPrice4(q.session.open)} /><Row k={t(l, 'high_px')} v={fmtPrice4(q.session.high)} /><Row k={t(l, 'low_px')} v={fmtPrice4(q.session.low)} />
      <Row k={t(l, 'volume')} v={q.session.volume ? ltr(q.session.volume.toLocaleString('en-US')) : '—'} />
      <Row k={t(l, 'rsi14')} v={ind?.rsi14 == null ? t(l, 'warmup') : ltr(ind.rsi14.toFixed(1))} />
      <Row k={t(l, 'sma20')} v={ind?.sma20 == null ? t(l, 'warmup') : fmtPrice4(ind.sma20)} />
      <Text style={[st.muted, { marginTop: 8 }]}>{t(l, 'window_note')}</Text></Card> : null}
  </ScrollView>);
}
