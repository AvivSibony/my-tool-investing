import React from 'react';
import { View, Text, Pressable, TextInput, StyleSheet } from 'react-native';
import Svg, { Polyline } from 'react-native-svg';
import { C, S } from './theme';
import { t, isRTL, Lang } from './i18n';

export const Card = ({ children }: { children: React.ReactNode }) => <View style={st.card}>{children}</View>;
export const Row = ({ k, v, color }: { k: string; v: string; color?: string }) =>
  <View style={st.row}><Text style={st.muted}>{k}</Text><Text style={[st.val, color ? { color } : null]}>{v}</Text></View>;
export const Btn = ({ title, onPress, kind = 'primary', disabled }: { title: string; onPress: () => void; kind?: 'primary' | 'ghost' | 'danger'; disabled?: boolean }) =>
  <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={[st.btn, kind === 'ghost' && st.ghost, kind === 'danger' && { backgroundColor: C.down }, disabled && { opacity: 0.4 }]}>
    <Text style={st.btnT}>{title}</Text></Pressable>;
export const Field = ({ label, error, ...p }: { label: string; error?: string } & React.ComponentProps<typeof TextInput>) =>
  <View style={{ marginBottom: S.md }}><Text style={st.muted}>{label}</Text>
    <TextInput {...p} placeholderTextColor={C.muted} style={[st.input, error ? { borderColor: C.down } : null]} accessibilityLabel={label} />
    {error ? <Text style={{ color: C.down, fontSize: 12 }}>{error}</Text> : null}</View>;
export const PaperBadge = ({ lang }: { lang: Lang }) => <View style={st.badge}><Text style={st.badgeT}>{t(lang, 'paper')}</Text></View>;
export function LineChart({ data, color = C.accent, h = 120 }: { data: number[]; color?: string; h?: number }) {
  if (data.length < 2) return <View style={{ height: h }} />;
  const w = 300, min = Math.min(...data), max = Math.max(...data), span = max - min || 1;
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * w},${h - ((v - min) / span) * (h - 8) - 4}`).join(' ');
  return <Svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none"><Polyline points={pts} fill="none" stroke={color} strokeWidth={2} /></Svg>;
}
export const align = (l: Lang) => ({ textAlign: isRTL(l) ? ('right' as const) : ('left' as const) });
export const st = StyleSheet.create({
  card: { backgroundColor: C.card, borderRadius: 16, padding: S.lg, marginBottom: S.md, borderWidth: 1, borderColor: C.line },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 }, muted: { color: C.muted, fontSize: 13 }, val: { color: C.text, fontSize: 15, fontWeight: '600' },
  btn: { backgroundColor: C.accent, borderRadius: 12, padding: 14, alignItems: 'center', marginTop: S.sm }, ghost: { backgroundColor: 'transparent', borderWidth: 1, borderColor: C.line },
  btnT: { color: '#fff', fontWeight: '700', fontSize: 15 }, input: { backgroundColor: C.bg, color: C.text, borderRadius: 10, borderWidth: 1, borderColor: C.line, padding: 10, marginTop: 4 },
  badge: { backgroundColor: '#3A2E05', borderRadius: 8, paddingVertical: 4, paddingHorizontal: 10, alignSelf: 'flex-start', marginBottom: S.md }, badgeT: { color: C.demo, fontSize: 12, fontWeight: '700' },
  screen: { flex: 1, backgroundColor: C.bg }, pad: { padding: S.lg }, h1: { color: C.text, fontSize: 28, fontWeight: '800' },
});
