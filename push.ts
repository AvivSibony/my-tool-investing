import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import type { Api } from './api';
import type { Lang } from './i18n';
Notifications.setNotificationHandler({ handleNotification: async () => ({ shouldShowAlert: true, shouldPlaySound: true, shouldSetBadge: false, shouldShowBanner: true, shouldShowList: true }) as any });
/** Asks permission, gets the Expo push token and registers it with the server. Needs a physical device and an EAS projectId (app.json extra.eas.projectId). */
export async function registerForPush(api: Api, lang: Lang): Promise<string | null> {
  if (!Device.isDevice) return null;
  if (Platform.OS === 'android') await Notifications.setNotificationChannelAsync('default', { name: 'default', importance: Notifications.AndroidImportance.HIGH });
  let { status } = await Notifications.getPermissionsAsync(); if (status !== 'granted') status = (await Notifications.requestPermissionsAsync()).status; if (status !== 'granted') return null;
  const projectId = (Constants.expoConfig?.extra as any)?.eas?.projectId; if (!projectId || String(projectId).startsWith('REPLACE')) return null;
  const { data } = await Notifications.getExpoPushTokenAsync({ projectId }); await api.registerPush(data, lang); return data;
}
