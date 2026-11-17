import React from 'react';
import { ScrollView, Text } from 'react-native';
import { useApp } from '../state'; import { t } from '../i18n'; import { fmtUsd, fmtPct, fmtPrice4, pnlColor } from '../format';
import { Card, Row, LineChart, PaperBadge, st } from '../ui'; import { C } from '../theme';

export default function Portfolio() {
  const { cfg, pf, series } = useApp(); const l = cfg.lang;
  if (!pf) return <ScrollView style={st.screen} contentContainerStyle={st.pad}><Text style={st.muted}>{t(l, 'no_bot')}</Text></ScrollView>;
  const opening = pf.equityCents - pf.realizedCents - pf.unrealizedCents; const total = pf.realizedCents + pf.unrealizedCents;
  return (<ScrollView style={st.screen} contentContainerStyle={st.pad}>
    <PaperBadge lang={l} />
    <Card><Text style={st.muted}>{t(l, 'equity')}</Text><Text style={st.h1}>{fmtUsd(pf.equityCents)}</Text>
      <Text style={{ color: pnlColor(total, C), fontWeight: '700' }}>{fmtUsd(total, true)} · {fmtPct(total, opening)}</Text>
      <LineChart data={series.eq} color={pnlColor(total, C) === C.muted ? C.accent : pnlColor(total, C)} /></Card>
    <Card><Row k={t(l, 'realized')} v={fmtUsd(pf.realizedCents, true)} color={pnlColor(pf.realizedCents, C)} />
      <Row k={t(l, 'unrealized')} v={fmtUsd(pf.unrealizedCents, true)} color={pnlColor(pf.unrealizedCents, C)} /></Card>
    <Card><Text style={st.muted}>{t(l, 'open_pos')}</Text>{pf.openPositions.length === 0 ? <Text style={st.val}>{t(l, 'none')}</Text> :
      pf.openPositions.map(p => <Row key={p.id} k={`${p.qty} @ ${fmtPrice4(p.entryPrice4)}`} v={fmtUsd(p.costCents)} />)}</Card>
    <Card><Text style={st.muted}>{t(l, 'closed_pos')}</Text>{pf.closedTrades.length === 0 ? <Text style={st.val}>{t(l, 'none')}</Text> :
      [...pf.closedTrades].reverse().map(x => <Row key={x.id} k={`${x.reason} · ${x.qty}`} v={fmtUsd(x.netPnlCents, true)} color={pnlColor(x.netPnlCents, C)} />)}</Card>
  </ScrollView>);
}
