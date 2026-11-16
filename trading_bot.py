"""בוט מסחר דמו (MVP) – ממוצעים נעים 20/50, ניהול סיכונים, ללא כסף אמיתי.
הרצה:
  python trading_bot.py --selftest            בדיקות אוטומטיות
  python trading_bot.py --demo                בדיקה על נתונים סינתטיים (בלי אינטרנט)
  python trading_bot.py --csv prices.csv      קובץ עם עמודות date,close
  python trading_bot.py --symbol SPY          נתוני עבר אמיתיים (דורש: pip install yfinance)
"""
import sys, csv, json, math, random

START_CASH = 100_000.0
FEE_FIXED, FEE_PCT, SLIPPAGE = 1.0, 0.0005, 0.0005   # עמלה קבועה, עמלה באחוזים, Slippage
RISK_PER_TRADE = 0.01      # מסכנים עד 1% מהתיק בעסקה
STOP_PCT = 0.05            # Stop Loss 5% מתחת לכניסה
MAX_PORTFOLIO_LOSS = 0.10  # עצירת הבוט אם התיק ירד 10%
FAST, SLOW = 20, 50
STATE_FILE = "bot_state.json"   # נשמר מקומית במחשב שלך בלבד


def sma(vals, n):
    return None if len(vals) < n else sum(vals[-n:]) / n


class Broker:
    """חשבון דמו. לא מתחבר לשום ברוקר אמיתי."""
    def __init__(self, cash=START_CASH):
        self.cash, self.qty, self.entry, self.trades = cash, 0, 0.0, []

    def equity(self, price):
        return self.cash + self.qty * price

    def buy(self, day, price, qty):
        px = price * (1 + SLIPPAGE)
        while qty > 0 and qty * px + FEE_FIXED + qty * px * FEE_PCT > self.cash:
            qty -= 1                                   # אף פעם לא קונים מעבר למזומן
        if qty <= 0:
            return False
        fee = FEE_FIXED + qty * px * FEE_PCT
        self.cash -= qty * px + fee
        self.qty, self.entry = qty, px
        self.trades.append(dict(day=day, side="קנייה", qty=qty, px=round(px, 2), fee=round(fee, 2)))
        return True

    def sell(self, day, price, why):
        if self.qty == 0:
            return False
        px = price * (1 - SLIPPAGE)
        fee = FEE_FIXED + self.qty * px * FEE_PCT
        pnl = self.qty * (px - self.entry) - fee
        self.cash += self.qty * px - fee
        self.trades.append(dict(day=day, side="מכירה", qty=self.qty, px=round(px, 2),
                                fee=round(fee, 2), pnl=round(pnl, 2), why=why))
        self.qty, self.entry = 0, 0.0
        return True


def position_size(equity, price):
    """כמה יחידות לקנות כך שהפסד ב-Stop יהיה בערך 1% מהתיק."""
    return max(0, math.floor(equity * RISK_PER_TRADE / (price * STOP_PCT)))


def backtest(days, closes):
    b, halted, curve, closed = Broker(), False, [], []
    signal = None
    for i, price in enumerate(closes):
        # ביצוע הפקודה שהוחלטה אתמול (מונע "הצצה לעתיד")
        if signal == "buy" and b.qty == 0 and not halted:
            b.buy(days[i], price, position_size(b.equity(price), price))
        elif signal == "sell":
            b.sell(days[i], price, "חצייה כלפי מטה")
        signal = None
        # Stop Loss
        if b.qty and price <= b.entry * (1 - STOP_PCT):
            b.sell(days[i], price, "Stop Loss")
        # הגנה על התיק
        if b.equity(price) < START_CASH * (1 - MAX_PORTFOLIO_LOSS) and not halted:
            b.sell(days[i], price, "עצירת חירום")
            halted = True
        # סיגנל להמשך
        now_f, now_s = sma(closes[:i + 1], FAST), sma(closes[:i + 1], SLOW)
        pf, ps = sma(closes[:i], FAST), sma(closes[:i], SLOW)
        if None not in (now_f, now_s, pf, ps):
            if pf <= ps and now_f > now_s and b.qty == 0:
                signal = "buy"
            elif pf >= ps and now_f < now_s and b.qty > 0:
                signal = "sell"
        curve.append(b.equity(price))
    return b, curve, halted


def max_drawdown(curve):
    peak, dd = curve[0], 0.0
    for v in curve:
        peak = max(peak, v)
        dd = max(dd, (peak - v) / peak)
    return dd


def report(b, curve, halted):
    end = curve[-1]
    sells = [t for t in b.trades if t["side"] == "מכירה"]
    wins = [t for t in sells if t["pnl"] > 0]
    print(f"\nתיק התחלתי: ${START_CASH:,.2f}   תיק סופי: ${end:,.2f}   תשואה: {(end/START_CASH-1)*100:+.2f}%")
    print(f"עסקאות שנסגרו: {len(sells)}   מתוכן ברווח: {len(wins)}   ירידה מקסימלית: {max_drawdown(curve)*100:.1f}%")
    if halted:
        print("⚠ הבוט נעצר: הגעת למגבלת ההפסד המקסימלי.")
    for t in b.trades[-8:]:
        print("  ", t)
    print("\nזהו סימולציה על נתוני עבר. תוצאות עבר אינן מבטיחות תוצאות עתידיות, ואין כאן ייעוץ השקעות.")
    json.dump(dict(cash=b.cash, qty=b.qty, entry=b.entry, trades=b.trades), open(STATE_FILE, "w"), ensure_ascii=False, indent=1)


def synthetic(n=400, seed=7):
    rnd, p, out = random.Random(seed), 100.0, []
    for i in range(n):
        p *= 1 + 0.0006 * math.sin(i / 40) * 6 + rnd.gauss(0, 0.01)
        out.append(round(p, 2))
    return [f"יום {i+1}" for i in range(n)], out


def load_csv(path):
    rows = list(csv.DictReader(open(path, encoding="utf-8")))
    return [r["date"] for r in rows], [float(r["close"]) for r in rows]


def load_yahoo(sym):
    import yfinance as yf   # רק כאן יש פנייה לאינטרנט, ורק כדי להוריד מחירים
    df = yf.download(sym, period="3y", progress=False, auto_adjust=True)
    c = df["Close"].squeeze()
    return [str(d.date()) for d in c.index], [float(x) for x in c.values]


def selftest():
    ok = lambda c, m: print(("✔ " if c else "✘ ") + m) or c
    r = []
    r.append(ok(abs(sma([1, 2, 3, 4], 2) - 3.5) < 1e-9 and sma([1], 2) is None, "ממוצע נע מחושב נכון"))
    b = Broker(1000)
    r.append(ok(not b.buy("d", 100, 50) or b.cash >= 0, "אי אפשר לקנות מעבר למזומן"))
    b = Broker(); b.buy("d", 100, 10); b.sell("d", 100, "x")
    r.append(ok(b.cash < START_CASH, "עמלות ו-Slippage מורידים רווח"))
    r.append(ok(not Broker().sell("d", 100, "x"), "אי אפשר למכור בלי פוזיציה"))
    q = position_size(100_000, 50)
    r.append(ok(abs(q * 50 * STOP_PCT - 1000) < 50 * STOP_PCT, "גודל פוזיציה = סיכון של 1% מהתיק"))
    d, c = synthetic(); b, curve, h = backtest(d, c)
    r.append(ok(all(v > 0 for v in curve) and b.cash >= 0, "מזומן ושווי תיק אף פעם לא שליליים"))
    r.append(ok(backtest(d, c)[1] == curve, "אותה ריצה נותנת אותה תוצאה"))
    d2, c2 = [str(i) for i in range(120)], [100 - i for i in range(120)]
    b, curve, h = backtest(d2, c2)
    r.append(ok(b.qty == 0 and len(b.trades) == 0, "שוק יורד בלבד: הבוט לא נכנס"))
    r.append(ok(FAST < SLOW and 0 < RISK_PER_TRADE <= 0.02, "הגדרות סיכון סבירות"))
    print(f"\n{sum(r)}/{len(r)} בדיקות עברו")
    return all(r)


if __name__ == "__main__":
    a = sys.argv[1:]
    if "--selftest" in a:
        sys.exit(0 if selftest() else 1)
    if "--csv" in a:
        days, closes = load_csv(a[a.index("--csv") + 1])
    elif "--symbol" in a:
        days, closes = load_yahoo(a[a.index("--symbol") + 1])
    else:
        days, closes = synthetic()
        print("מצב דמו: נתונים סינתטיים, לא שוק אמיתי.")
    report(*backtest(days, closes))
