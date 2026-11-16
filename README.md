# בוט מסחר דמו

בוט מסחר לחשבון **דמו בלבד** (ללא כסף אמיתי): סריקה יומית, בדיקה על נתוני עבר, התראות לטלגרם.
אין כאן ייעוץ השקעות. תוצאות עבר אינן מבטיחות תוצאות עתידיות.

## קבצים
- `bot_server.py` – הבוט המלא: שרת מקומי, סריקה יומית, בדיקה על שנות עבר
- `trading_bot.py` – גרסה פשוטה לבדיקת אסטרטגיה אחת
- `trading-bot-lab.html` – מעבדה בדפדפן (פותחים בלחיצה כפולה)

## אייקונים
התיקייה `icons/`: `icon.svg` (וקטורי), `icon-512.png`, `icon-192.png`, `icon-1024.png`, `icon-1024-ios.png` (ריבוע מלא ל-iOS), `apple-touch-icon.png`, `favicon.ico`.

## הרצה
```
pip install -r requirements.txt
python bot_server.py --selftest              # בדיקות
python bot_server.py --once                  # סריקה אחת
python bot_server.py --backtest SPY,QQQ,GLD  # בדיקה על 10 שנים
python bot_server.py                         # שרת + סריקה יומית: http://localhost:8000
```

## התראות בטלגרם (אופציונלי)
למלא `token` ו-`chat_id` בקובץ `config.json` (נוצר בהרצה הראשונה). הקובץ לא עולה לגיטהאב.
