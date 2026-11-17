import React, { useState } from 'react';
import { ScrollView, Text, I18nManager } from 'react-native';
import { useApp } from '../state'; import { t, isRTL, Key } from '../i18n'; import { Btn, Field, PaperBadge, st } from '../ui'; import { authenticate, ApiError } from '../api'; import { C } from '../theme'; import { isAllowedServerUrl } from '../url';

export default function Settings() {
  const { cfg, save, api } = useApp(); const l = cfg.lang; const [url, setUrl] = useState(cfg.baseUrl); const [email, setEmail] = useState(''); const [pw, setPw] = useState('');
  const [note, setNote] = useState(false); const [err, setErr] = useState<Key | null>(null); const [busy, setBusy] = useState(false);
  const pick = async (nl: 'he' | 'en') => { await save({ lang: nl }); if (I18nManager.isRTL !== isRTL(nl)) { I18nManager.allowRTL(true); I18nManager.forceRTL(isRTL(nl)); setNote(true); } };
  const go = async (mode: 'login' | 'register') => {
    setErr(null); const base = url.trim().replace(/\/$/, ''); if (!isAllowedServerUrl(base)) { setErr('err_https'); return; }
    setBusy(true);
    try { const token = await authenticate(base, mode, email.trim(), pw); await save({ baseUrl: base, token, botId: '' }); setPw(''); }
    catch (e: any) { setErr(e instanceof ApiError ? (e.status === 409 ? 'err_taken' : e.status === 429 ? 'err_limit' : 'err_auth') : 'err_auth'); } finally { setBusy(false); }
  };
  return (<ScrollView style={st.screen} contentContainerStyle={st.pad}><PaperBadge lang={l} />
    <Text style={st.muted}>{t(l, 'language')}</Text><Btn kind={l === 'he' ? 'primary' : 'ghost'} title="עברית" onPress={() => pick('he')} /><Btn kind={l === 'en' ? 'primary' : 'ghost'} title="English" onPress={() => pick('en')} />
    {note ? <Text style={{ color: C.demo, marginTop: 8 }}>{t(l, 'restart_rtl')}</Text> : null}
    <Field label={t(l, 'server_url')} value={url} onChangeText={setUrl} autoCapitalize="none" error={err === 'err_https' ? t(l, 'err_https') : undefined} />
    {api ? <><Text style={{ color: C.up, marginVertical: 8 }}>{t(l, 'logged_in')}</Text>
      <Btn kind="ghost" title={t(l, 'logout')} onPress={async () => { try { if (cfg.pushToken) await api.unregisterPush(cfg.pushToken); await api.logout(); } catch {} await save({ token: '', botId: '', pushToken: '' }); }} /></> : <>
      <Field label={t(l, 'email')} value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" />
      <Field label={t(l, 'password')} value={pw} onChangeText={setPw} secureTextEntry autoComplete="password" error={err && err !== 'err_https' ? t(l, err) : undefined} />
      <Btn title={t(l, 'login')} onPress={() => go('login')} disabled={busy} /><Btn kind="ghost" title={t(l, 'register')} onPress={() => go('register')} disabled={busy} /></>}
  </ScrollView>);
}
