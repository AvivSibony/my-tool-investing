import React from 'react';
import { FlatList, Text, View } from 'react-native';
import { useApp } from '../state'; import { t, Key } from '../i18n'; import { fmtTime, fmtPrice4 } from '../format'; import { st } from '../ui'; import { C } from '../theme';

export default function Activity() {
  const { cfg, events, live } = useApp(); const l = cfg.lang;
  return (<FlatList style={st.screen} contentContainerStyle={st.pad} data={[...events].reverse()} keyExtractor={(e, i) => `${e.ts}-${e.type}-${i}`}
    ListHeaderComponent={<Text style={{ color: live ? C.up : C.demo, marginBottom: 8 }}>{t(l, live ? 'conn_ok' : 'conn_down')}</Text>}
    ListEmptyComponent={<Text style={st.muted}>{t(l, 'none')}</Text>}
    renderItem={({ item }) => (<View style={st.card}><Text style={st.val}>{t(l, `ev_${item.type}` as Key) ?? item.type}</Text>
      <Text style={st.muted}>{fmtTime(item.ts)}{item.price4 ? `  ·  ${fmtPrice4(item.price4)}` : ''}</Text></View>)} />);
}
