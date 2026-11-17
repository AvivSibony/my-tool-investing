import React from 'react';
import { NavigationContainer, DarkTheme } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { AppProvider, useApp } from './src/state'; import { t } from './src/i18n'; import { C } from './src/theme';
import BotSetup from './src/screens/BotSetup'; import Market from './src/screens/Market'; import Portfolio from './src/screens/Portfolio';
import Activity from './src/screens/Activity'; import Settings from './src/screens/Settings';
const Tab = createBottomTabNavigator();
function Tabs() {
  const { cfg } = useApp(); const l = cfg.lang;
  return (<Tab.Navigator screenOptions={{ tabBarStyle: { backgroundColor: C.card, borderTopColor: C.line }, tabBarActiveTintColor: C.accent, headerStyle: { backgroundColor: C.bg }, headerTintColor: C.text }}>
    <Tab.Screen name="Setup" component={BotSetup} options={{ title: t(l, 'tabs_setup') }} /><Tab.Screen name="Market" component={Market} options={{ title: t(l, 'tabs_market') }} />
    <Tab.Screen name="Portfolio" component={Portfolio} options={{ title: t(l, 'tabs_portfolio') }} /><Tab.Screen name="Activity" component={Activity} options={{ title: t(l, 'tabs_activity') }} />
    <Tab.Screen name="Settings" component={Settings} options={{ title: t(l, 'tabs_settings') }} /></Tab.Navigator>);
}
export default function App() {
  return <AppProvider><NavigationContainer theme={{ ...DarkTheme, colors: { ...DarkTheme.colors, background: C.bg, card: C.card } }}><Tabs /></NavigationContainer></AppProvider>;
}
