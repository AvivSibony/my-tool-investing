export type Lang = 'he' | 'en';
export const isRTL = (l: Lang) => l === 'he';
const en = {
  paper: 'DEMO · virtual money only', tabs_setup: 'Bot', tabs_market: 'Market', tabs_portfolio: 'Portfolio', tabs_activity: 'Activity', tabs_settings: 'Settings',
  symbol: 'Symbol', budget: 'Virtual amount (USD)', trigger: 'Entry trigger', trig_price_at: 'Price reaches', trig_above: 'Rises above', trig_below: 'Falls below',
  entry_price: 'Entry price (USD)', rsi: 'RSI below (optional)', tp: 'Take profit % (optional)', sl: 'Stop loss % (optional)', trail: 'Trailing stop % (optional)',
  hold: 'Max hold, minutes (optional)', fee: 'Fee (bps)', slip: 'Slippage (bps)', maxpos: 'Max open positions', review: 'Review', confirm_title: 'Confirm bot settings',
  confirm_btn: 'Confirm & start (demo)', cancel: 'Cancel', stop_bot: 'Stop bot', start_bot: 'Start bot',
  err_symbol: 'Use 1-6 capital letters', err_budget: 'Enter 1 to 1,000,000', err_price: 'Enter a price above 0', err_pct: 'Enter 0.01 to 100', err_int: 'Enter a whole number', err_rsi: 'Enter 1 to 99',
  equity: 'Portfolio value', realized: 'Realized P&L', unrealized: 'Unrealized P&L', ret: 'Return', open_pos: 'Open positions', closed_pos: 'Closed trades', none: 'Nothing yet',
  last_price: 'Last price', source: 'Source', freshness: 'Data type', last_update: 'Last update', na: 'Not available from the server yet', no_bot: 'Create a bot first',
  fresh_REALTIME: 'Real-time', fresh_DELAYED: 'Delayed', fresh_HISTORICAL: 'Historical', fresh_DEMO: 'DEMO data (not real)',
  ev_BOT_STARTED: 'Bot started', ev_BOT_STOPPED: 'Bot stopped', ev_ENTRY_CONDITION_MET: 'Entry condition met', ev_POSITION_OPENED: 'Virtual trade opened',
  ev_ENTRY_SKIPPED: 'Entry skipped (funds)', ev_POSITION_CLOSED: 'Virtual trade closed', ev_DATA_STALE: 'Data stale - bot paused', ev_DATA_DISCONNECTED: 'Data disconnected', ev_DATA_RECONNECTED: 'Data reconnected',
  server_url: 'Server URL', email: 'Email', password: 'Password (10+ characters)', login: 'Log in', register: 'Create account', logout: 'Log out', logged_in: 'Signed in', err_auth: 'Could not sign in. Check your details.', err_taken: 'This email is already registered', err_https: 'Use an https:// address (http only for local development)', err_limit: 'Too many attempts. Try again later.', save: 'Save', language: 'Language', restart_rtl: 'Restart the app to apply text direction', conn_ok: 'Live connection', open_px: 'Open', high_px: 'High', low_px: 'Low', volume: 'Volume', rsi14: 'RSI (14, 1-min)', sma20: 'SMA (20, 1-min)', warmup: 'Collecting data…', no_quote: 'No quotes received yet', window_note: 'Stats since the server started, from received ticks only (not full-day exchange data)', conn_down: 'Reconnecting…',
};
const he: typeof en = {
  paper: 'הדגמה · כסף וירטואלי בלבד', tabs_setup: 'בוט', tabs_market: 'שוק', tabs_portfolio: 'תיק', tabs_activity: 'פעילות', tabs_settings: 'הגדרות',
  symbol: 'סימול', budget: 'סכום וירטואלי (דולר)', trigger: 'תנאי כניסה', trig_price_at: 'המחיר מגיע ל', trig_above: 'עולה מעל', trig_below: 'יורד מתחת ל',
  entry_price: 'מחיר כניסה (דולר)', rsi: 'RSI מתחת ל (אופציונלי)', tp: 'יעד רווח % (אופציונלי)', sl: 'הגבלת הפסד % (אופציונלי)', trail: 'Trailing Stop % (אופציונלי)',
  hold: 'זמן החזקה מרבי, דקות (אופציונלי)', fee: 'עמלה (bps)', slip: 'הפרש ביצוע (bps)', maxpos: 'מקסימום פוזיציות פתוחות', review: 'סקירה', confirm_title: 'אישור הגדרות הבוט',
  confirm_btn: 'אישור והפעלה (דמו)', cancel: 'ביטול', stop_bot: 'עצור בוט', start_bot: 'הפעל בוט',
  err_symbol: 'יש להזין 1-6 אותיות גדולות', err_budget: 'יש להזין 1 עד 1,000,000', err_price: 'יש להזין מחיר גדול מ-0', err_pct: 'יש להזין 0.01 עד 100', err_int: 'יש להזין מספר שלם', err_rsi: 'יש להזין 1 עד 99',
  equity: 'שווי תיק', realized: 'רווח/הפסד ממומש', unrealized: 'רווח/הפסד שטרם מומש', ret: 'תשואה', open_pos: 'עסקאות פתוחות', closed_pos: 'עסקאות סגורות', none: 'אין עדיין',
  last_price: 'מחיר אחרון', source: 'מקור', freshness: 'סוג נתונים', last_update: 'עדכון אחרון', na: 'עדיין לא זמין מהשרת', no_bot: 'יש ליצור בוט קודם',
  fresh_REALTIME: 'זמן אמת', fresh_DELAYED: 'מושהה', fresh_HISTORICAL: 'היסטורי', fresh_DEMO: 'נתוני הדגמה (לא אמיתיים)',
  ev_BOT_STARTED: 'הבוט הופעל', ev_BOT_STOPPED: 'הבוט נעצר', ev_ENTRY_CONDITION_MET: 'תנאי כניסה התקיים', ev_POSITION_OPENED: 'עסקה וירטואלית נפתחה',
  ev_ENTRY_SKIPPED: 'כניסה דולגה (חוסר יתרה)', ev_POSITION_CLOSED: 'עסקה וירטואלית נסגרה', ev_DATA_STALE: 'נתונים ישנים - הבוט הושהה', ev_DATA_DISCONNECTED: 'חיבור הנתונים נותק', ev_DATA_RECONNECTED: 'חיבור הנתונים חודש',
  server_url: 'כתובת שרת', email: 'אימייל', password: 'סיסמה (10 תווים לפחות)', login: 'התחברות', register: 'יצירת חשבון', logout: 'התנתקות', logged_in: 'מחובר', err_auth: 'ההתחברות נכשלה. בדוק את הפרטים.', err_taken: 'האימייל הזה כבר רשום', err_https: 'יש להשתמש בכתובת https:// (http רק לפיתוח מקומי)', err_limit: 'יותר מדי ניסיונות. נסה שוב מאוחר יותר.', save: 'שמירה', language: 'שפה', restart_rtl: 'יש להפעיל מחדש את האפליקציה להחלת כיוון הטקסט', conn_ok: 'חיבור חי', open_px: 'פתיחה', high_px: 'גבוה', low_px: 'נמוך', volume: 'מחזור', rsi14: 'RSI (‏14, דקה)', sma20: 'ממוצע נע (‏20, דקה)', warmup: 'אוסף נתונים…', no_quote: 'עדיין לא התקבלו מחירים', window_note: 'נתונים מאז הפעלת השרת, מתוך המחירים שהתקבלו בלבד (לא נתוני יום מלאים מהבורסה)', conn_down: 'מתחבר מחדש…',
};
export const dict = { en, he };
export type Key = keyof typeof en;
export const t = (l: Lang, k: Key) => dict[l][k];
