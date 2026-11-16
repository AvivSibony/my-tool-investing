"""בוט מסחר יומי (דמו בלבד) + שרת מקומי + התראות.
התקנה:   pip install yfinance
הרצה:    python bot_server.py            (שרת + סריקה יומית אוטומטית, פתח http://localhost:8000)
         python bot_server.py --once     (סריקה אחת עכשיו)
         python bot_server.py --backtest SPY,QQQ,AAPL  (בדיקה על 10 שנות עבר, סימול אחד או כמה)
         python bot_server.py --selftest (בדיקות)
כל המידע נשמר בתיקייה הזו בלבד. אין חיבור לברוקר ואין כסף אמיתי.
האינטרנט משמש רק להורדת מחירים (yfinance) ולשליחת התראה לטלגרם אם הגדרת טוקן."""
import datetime as dt, json, math, os, random, sys, threading, time, urllib.parse, urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

D = os.path.dirname(os.path.abspath(__file__))
CFG, STATE = os.path.join(D, "config.json"), os.path.join(D, "state.json")
DEFAULT = {"watchlist": ["SPY", "QQQ", "AAPL"], "strategies": ["sma", "rsi", "brk", "bb", "mom"], "params": {},
           "risk": {"cash": 100000, "risk": 1, "stop": 5, "maxl": 10, "fee": 0.05, "fx": 1, "slip": 0.05},
           "min_agree": 2, "run_time": "07:30", "offline": False, "port": 8000,
           "telegram": {"token": "", "chat_id": ""}}


def load(path, default):
    try:
        return json.load(open(path, encoding="utf-8"))
    except Exception:
        return json.loads(json.dumps(default))


def save(path, obj):
    json.dump(obj, open(path, "w", encoding="utf-8"), ensure_ascii=False, indent=1)


def cfg():
    c = load(CFG, DEFAULT)
    for k, v in DEFAULT.items():
        c.setdefault(k, v)
    return c


# ---------- אסטרטגיות ----------
def sma(c, n, i): return None if i + 1 < n or i < 0 else sum(c[i + 1 - n:i + 1]) / n


def s_sma(c, i, P):
    a, b, x, y = sma(c, P["fast"], i), sma(c, P["slow"], i), sma(c, P["fast"], i - 1), sma(c, P["slow"], i - 1)
    if None in (a, b, x, y): return None
    return "buy" if x <= y and a > b else "sell" if x >= y and a < b else None


def s_rsi(c, i, P):
    n = P["n"]
    if i < n: return None
    g = sum(max(c[k] - c[k - 1], 0) for k in range(i - n + 1, i + 1))
    l = sum(max(c[k - 1] - c[k], 0) for k in range(i - n + 1, i + 1))
    r = 100 if l == 0 else 100 - 100 / (1 + g / l)
    return "buy" if r < P["lo"] else "sell" if r > P["hi"] else None


def s_brk(c, i, P):
    if i < max(P["n"], P["x"]): return None
    return "buy" if c[i] > max(c[i - P["n"]:i]) else "sell" if c[i] < min(c[i - P["x"]:i]) else None


def s_bb(c, i, P):
    m = sma(c, P["n"], i)
    if m is None: return None
    sd = math.sqrt(sum((v - m) ** 2 for v in c[i + 1 - P["n"]:i + 1]) / P["n"])
    return "buy" if c[i] < m - P["k"] * sd else "sell" if c[i] > m else None


def s_mom(c, i, P):
    if i < P["n"]: return None
    r = (c[i] / c[i - P["n"]] - 1) * 100
    return "buy" if r > P["th"] else "sell" if r < 0 else None


STRATS = {"sma": ("ממוצעים נעים", s_sma, {"fast": 20, "slow": 50}),
          "rsi": ("RSI היפוך", s_rsi, {"n": 14, "lo": 30, "hi": 70}),
          "brk": ("פריצת שיא", s_brk, {"n": 20, "x": 10}),
          "bb": ("בולינגר", s_bb, {"n": 20, "k": 2}),
          "mom": ("מומנטום", s_mom, {"n": 60, "th": 5})}


# ---------- נתונים ----------
def prices(sym, offline, period="2y", n=300):
    if offline:                       # נתונים סינתטיים לבדיקה בלבד
        r, p, out = random.Random(sym), 100.0, []
        for _ in range(n):
            p *= 1 + r.gauss(0.0004, 0.011); out.append(p)
        return out
    import yfinance as yf
    df = yf.download(sym, period=period, progress=False, auto_adjust=True)
    out = [float(x) for x in df["Close"].squeeze().dropna().values]
    if len(out) < 60: raise ValueError("לא התקבלו מספיק נתונים")
    return out


def size(equity, px, R): return max(0, math.floor(equity * R["risk"] / 100 / (px * R["stop"] / 100)))


# ---------- סריקה יומית ----------
def scan(c):
    R = c["risk"]
    st = load(STATE, {"paper": {"cash": R["cash"], "pos": {}, "halted": False}})
    pa, recs, last = st["paper"], [], {}
    for sym in c["watchlist"]:
        try:
            cl = prices(sym, c["offline"])
        except Exception as e:
            recs.append({"sym": sym, "error": str(e)}); continue
        i, px = len(cl) - 1, cl[-1]; last[sym] = px
        votes = {"buy": [], "sell": []}
        for k in c["strategies"]:
            name, fn, d = STRATS[k]
            s = fn(cl, i, {**d, **c["params"].get(k, {})})
            if s: votes[s].append(name)
        for s in votes:
            if votes[s]:
                recs.append({"sym": sym, "signal": s, "price": round(px, 2), "by": votes[s],
                             "stop": round(px * (1 - R["stop"] / 100), 2) if s == "buy" else None})
        pos = pa["pos"].get(sym)                       # חשבון דמו: פועל לפי הסכמה של כמה אסטרטגיות
        eq = pa["cash"] + sum(q["qty"] * last.get(s, q["entry"]) for s, q in pa["pos"].items())
        if pos and (px <= pos["entry"] * (1 - R["stop"] / 100) or len(votes["sell"]) >= c["min_agree"]):
            x = px * (1 - R["slip"] / 100); pa["cash"] += pos["qty"] * x - R["fx"] - pos["qty"] * x * R["fee"] / 100
            del pa["pos"][sym]
        elif not pos and not pa["halted"] and len(votes["buy"]) >= c["min_agree"]:
            x, n = px * (1 + R["slip"] / 100), size(eq, px, R)
            while n > 0 and n * x * (1 + R["fee"] / 100) + R["fx"] > pa["cash"]: n -= 1
            if n > 0:
                pa["cash"] -= n * x + R["fx"] + n * x * R["fee"] / 100; pa["pos"][sym] = {"qty": n, "entry": x}
    eq = pa["cash"] + sum(q["qty"] * last.get(s, q["entry"]) for s, q in pa["pos"].items())
    if eq < R["cash"] * (1 - R["maxl"] / 100): pa["halted"] = True
    rep = {"date": str(dt.date.today()), "recs": recs, "equity": round(eq, 2), "halted": pa["halted"]}
    st["paper"], st["report"] = pa, rep
    save(STATE, st)
    alert(c, text(rep))
    return rep


def text(rep):
    L = [f"סריקה יומית {rep['date']}"]
    good = [r for r in rep["recs"] if r.get("signal")]
    if not good: L.append("אין כרגע הזדמנות איכותית.")
    for r in good:
        L.append(f"{'קנייה' if r['signal']=='buy' else 'מכירה'} {r['sym']} @ {r['price']} ({', '.join(r['by'])})"
                 + (f" · Stop {r['stop']}" if r["stop"] else ""))
    for r in rep["recs"]:
        if r.get("error"): L.append(f"שגיאת נתונים ב-{r['sym']}: {r['error']}")
    L.append(f"שווי חשבון דמו: ${rep['equity']:,.2f}")
    if rep["halted"]: L.append("⚠ חשבון הדמו נעצר: הגעת להפסד המקסימלי.")
    L.append("דמו בלבד, לא ייעוץ השקעות.")
    return "\n".join(L)


def alert(c, msg):
    print("\n" + msg)
    t = c["telegram"]
    if t.get("token") and t.get("chat_id"):
        try:
            data = urllib.parse.urlencode({"chat_id": t["chat_id"], "text": msg}).encode()
            urllib.request.urlopen(f"https://api.telegram.org/bot{t['token']}/sendMessage", data, timeout=10)
        except Exception as e:
            print("שליחת התראה נכשלה:", e)


# ---------- בדיקה על שנים של נתוני עבר ----------
def bt(cl, key, R, P):
    fn, d = STRATS[key][1], {**STRATS[key][2], **P}
    cash, q, en, sig, halt, eq, pn = R["cash"], 0, 0.0, None, False, [], []

    def sell(p):
        nonlocal cash, q
        x = p * (1 - R["slip"] / 100); f = R["fx"] + q * x * R["fee"] / 100
        pn.append(q * (x - en) - f); cash += q * x - f; q = 0

    for i, p in enumerate(cl):
        if sig == "buy" and not q and not halt:
            n, x = size(cash, p, R), p * (1 + R["slip"] / 100)
            while n > 0 and n * x * (1 + R["fee"] / 100) + R["fx"] > cash: n -= 1
            if n > 0: cash -= n * x + R["fx"] + n * x * R["fee"] / 100; q, en = n, x
        elif sig == "sell" and q: sell(p)
        sig = None
        if q and p <= en * (1 - R["stop"] / 100): sell(p)
        if not halt and cash + q * p < R["cash"] * (1 - R["maxl"] / 100):
            if q: sell(p)
            halt = True
        s = fn(cl, i, d)
        if s and not (s == "buy" and q) and not (s == "sell" and not q): sig = s
        eq.append(cash + q * p)
    return eq, pn


def maxdd(e):
    pk, dd = e[0], 0.0
    for v in e: pk = max(pk, v); dd = max(dd, (pk - v) / pk)
    return dd * 100


def backtest_text(sym, c):
    cl = prices(sym, c["offline"], "10y", 2500)
    R, k = c["risk"], int(len(cl) * 0.7)
    L = [f"בדיקה על {len(cl)} ימי מסחר של {sym}. 70% ראשונים = אימון, 30% אחרונים = מבחן שהאסטרטגיה לא ״ראתה״.",
         "אסטרטגיה | סה״כ | אימון | מבחן | ירידה מקס׳ | עסקאות | הערכה"]
    for key in c["strategies"]:
        eq, pn = bt(cl, key, R, c["params"].get(key, {}))
        tr, te = (eq[k - 1] / R["cash"] - 1) * 100, (eq[-1] / eq[k - 1] - 1) * 100
        ok = tr > 0 and te > 0 and len(pn) >= 6
        L.append(f"{STRATS[key][0]} | {(eq[-1]/R['cash']-1)*100:+.1f}% | {tr:+.1f}% | {te:+.1f}% | {maxdd(eq):.1f}% | {len(pn)} | "
                 + ("רווחית בשני החלקים" if ok else "לא עקבית או מעט עסקאות"))
    L.append(f"קנה והחזק | {(cl[-1]/cl[0]-1)*100:+.1f}% | {(cl[k-1]/cl[0]-1)*100:+.1f}% | {(cl[-1]/cl[k-1]-1)*100:+.1f}% | {maxdd(cl):.1f}% | 1 | השוואה")
    L.append("זהירות: מעט עסקאות = תוצאה אקראית. אסטרטגיה שנבחרה אחרי שראית את התוצאות עלולה להיות מותאמת לעבר. דמו בלבד, לא ייעוץ השקעות.")
    return "\n".join(L)


def backtest_multi(syms, c):
    R, rows, errs = c["risk"], {k: [] for k in c["strategies"]}, []
    for sym in syms:
        try: cl = prices(sym, c["offline"], "10y", 2500)
        except Exception as e: errs.append(f"{sym}: {e}"); continue
        k = int(len(cl) * 0.7)
        for key in c["strategies"]:
            eq, pn = bt(cl, key, R, c["params"].get(key, {}))
            rows[key].append(((eq[k - 1] / R["cash"] - 1) * 100, (eq[-1] / eq[k - 1] - 1) * 100, maxdd(eq), len(pn)))
    m = max((len(v) for v in rows.values()), default=0)
    if m == 0: return "לא התקבלו נתונים: " + "; ".join(errs)
    L = [f"בדיקה על {m} סימולים ({', '.join(syms)}), 10 שנים, 70% אימון / 30% מבחן.",
         "אסטרטגיה | סימולים רווחיים בשני החלקים | מבחן ממוצע | ירידה מקס׳ ממוצעת | הערכה"]
    for key, r in rows.items():
        if not r: continue
        good = sum(1 for tr, te, _, t in r if tr > 0 and te > 0 and t >= 6)
        L.append(f"{STRATS[key][0]} | {good} מתוך {len(r)} | {sum(x[1] for x in r)/len(r):+.1f}% | {sum(x[2] for x in r)/len(r):.1f}% | "
                 + ("עקבית יחסית" if len(r) >= 3 and good >= math.ceil(0.7 * len(r)) else "לא עקבית או מעט סימולים"))
    L += [f"שגיאת נתונים: {e}" for e in errs]
    L.append("זהירות: סימולים באותו שוק נעים יחד, ולכן הם לא עצמאיים לגמרי. דמו בלבד, לא ייעוץ השקעות.")
    return "\n".join(L)


def run_backtest(arg, c):
    syms = [x for x in __import__("re").split(r"[,\s]+", arg.upper()) if x]
    if len(syms) != 1: return backtest_multi(syms or ["SPY"], c)
    try: return backtest_text(syms[0], c)
    except Exception as e: return f"לא התקבלו נתונים: {syms[0]}: {e}"


# ---------- שרת מקומי ----------
PAGE = """<!DOCTYPE html><html lang=he dir=rtl><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">
<title>בוט מסחר</title><link rel=icon href=/icon.svg><style>body{font-family:Arial;max-width:560px;margin:auto;padding:14px;background:#eef2f5;color:#14232e}
pre{background:#fff;padding:12px;border-radius:10px;white-space:pre-wrap}textarea{width:100%;height:260px;direction:ltr}
button{padding:10px 14px;margin:4px 0;border:0;border-radius:8px;background:#0f4c5c;color:#fff;font:inherit;cursor:pointer}</style>
<h1>בוט מסחר – דמו</h1><button onclick=run()>הרץ סריקה עכשיו</button><pre id=r>טוען…</pre>
<h2>בדיקה על שנות עבר</h2><input id=sym value="SPY,QQQ,AAPL" size=22> <button onclick=bk()>הרץ בדיקה</button><pre id=bt></pre>
<h2>הגדרות (JSON)</h2><textarea id=c></textarea><br><button onclick=sv()>שמור הגדרות</button>
<script>async function ld(){let r=await(await fetch('/api/report')).json();document.getElementById('r').textContent=r.text;
document.getElementById('c').value=JSON.stringify(r.config,null,1)}
async function bk(){bt.textContent='מוריד נתונים ובודק…';let r=await(await fetch('/api/backtest?sym='+encodeURIComponent(sym.value))).json();bt.textContent=r.text}
async function run(){document.getElementById('r').textContent='סורק…';await fetch('/api/scan',{method:'POST'});ld()}
async function sv(){try{JSON.parse(c.value)}catch(e){return alert('JSON לא תקין')}await fetch('/api/config',{method:'POST',body:c.value});alert('נשמר');}
ld()</script></html>"""


class H(BaseHTTPRequestHandler):
    def allowed(self):
        """דוחה בקשות מאתרים אחרים שפתוחים בדפדפן (CSRF / DNS rebinding)."""
        host, origin = self.headers.get("Host", ""), self.headers.get("Origin", "")
        ok_host = host.split(":")[0] in ("localhost", "127.0.0.1")
        ok_origin = origin == "" or urllib.parse.urlparse(origin).hostname in ("localhost", "127.0.0.1")
        if not (ok_host and ok_origin):
            self.send_response(403); self.end_headers(); return False
        return True

    def out(self, body, ctype="application/json"):
        b = body.encode("utf-8") if isinstance(body, str) else body
        self.send_response(200); self.send_header("Content-Type", ctype + "; charset=utf-8")
        self.send_header("Content-Length", str(len(b))); self.end_headers(); self.wfile.write(b)

    def do_GET(self):
        if not self.allowed(): return
        if self.path in ("/icon.svg", "/favicon.ico"):
            p = os.path.join(D, "icons", "icon.svg")
            if os.path.exists(p): return self.out(open(p, "rb").read(), "image/svg+xml")
            self.send_response(404); return self.end_headers()
        if self.path.startswith("/api/backtest"):
            q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query).get("sym", ["SPY"])[0]
            try: t = run_backtest(q, cfg())
            except Exception as e: t = f"שגיאה: {e}"
            self.out(json.dumps({"text": t}, ensure_ascii=False))
        elif self.path == "/api/report":
            rep = load(STATE, {}).get("report")
            self.out(json.dumps({"text": text(rep) if rep else "עדיין לא בוצעה סריקה.", "config": masked(cfg())}, ensure_ascii=False))
        else:
            self.out(PAGE, "text/html")

    def do_POST(self):
        if not self.allowed(): return
        body = self.rfile.read(int(self.headers.get("Content-Length", 0) or 0))
        if self.path == "/api/scan": scan(cfg())
        elif self.path == "/api/config": save(CFG, keep_token(json.loads(body)))
        self.out("{}")

    def log_message(self, *a): pass


def masked(c):
    c = json.loads(json.dumps(c))
    if c["telegram"].get("token"): c["telegram"]["token"] = "***"
    return c


def keep_token(new):
    if new.get("telegram", {}).get("token") == "***": new["telegram"]["token"] = cfg()["telegram"].get("token", "")
    return new


def scheduler():
    done = None
    while True:
        c, now = cfg(), dt.datetime.now()
        if now.strftime("%H:%M") >= c["run_time"] and done != now.date() and now.weekday() != 5:
            done = now.date()
            try: scan(c)
            except Exception as e: print("שגיאת סריקה:", e)
        time.sleep(30)


def selftest():
    global STATE
    import tempfile
    STATE = os.path.join(tempfile.mkdtemp(), "s.json")
    r, ok = [], lambda c, m: print(("✔ " if c else "✘ ") + m) or c
    r.append(ok(size(100000, 50, DEFAULT["risk"]) * 50 * 0.05 <= 1000 + 2.5, "גודל פוזיציה לא מסכן יותר מ-1%"))
    r.append(ok(s_mom([1.0] * 5, 4, {"n": 60, "th": 5}) is None, "מעט נתונים: אין סיגנל ואין קריסה"))
    c = {**DEFAULT, "offline": True}
    rep = scan(c)
    r.append(ok(rep["equity"] > 0 and "date" in rep, "סריקה מלאה על נתוני דמו עוברת"))
    scan(c); r.append(ok(True, "סריקה חוזרת (חשבון דמו קיים) לא קורסת"))
    r.append(ok(all(q["qty"] > 0 for q in load(STATE, {})["paper"]["pos"].values()), "אין פוזיציות עם כמות לא חוקית"))
    c2 = {**c, "watchlist": ["X"], "offline": False}
    r.append(ok(any("error" in x for x in scan(c2)["recs"]), "שגיאת נתונים מטופלת בלי קריסה"))
    t = backtest_text("SPY", {**DEFAULT, "offline": True})
    r.append(ok(all(STRATS[k][0] in t for k in STRATS) and "קנה והחזק" in t, "בדיקת עבר מציגה את כל האסטרטגיות והשוואה"))
    eq, pn = bt(prices("T", True, n=2500), "sma", DEFAULT["risk"], {})
    r.append(ok(all(v > 0 for v in eq) and len(eq) == 2500, "בדיקת עבר: שווי תיק חיובי לאורך כל התקופה"))
    m = run_backtest("SPY, QQQ AAPL,MSFT", {**DEFAULT, "offline": True})
    r.append(ok("4 סימולים" in m and all(STRATS[k][0] in m for k in STRATS), "בדיקה על כמה סימולים (פסיקים ורווחים) עובדת"))
    r.append(ok("לא התקבלו נתונים" in run_backtest("ZZZ", {**DEFAULT, "offline": False, "strategies": ["sma"]}), "כשל בהורדת נתונים מוצג בבירור"))
    r.append(ok(masked({**DEFAULT, "telegram": {"token": "abc", "chat_id": "1"}})["telegram"]["token"] == "***", "טוקן הטלגרם לא נחשף בדף"))
    print(f"\n{sum(r)}/{len(r)} בדיקות עברו"); return all(r)


if __name__ == "__main__":
    a = sys.argv[1:]
    if "--selftest" in a: sys.exit(0 if selftest() else 1)
    if not os.path.exists(CFG): save(CFG, DEFAULT)
    if "--backtest" in a: print(run_backtest(a[a.index("--backtest") + 1], cfg())); sys.exit()
    if "--once" in a: scan(cfg()); sys.exit()
    threading.Thread(target=scheduler, daemon=True).start()
    port = cfg()["port"]
    print(f"פתח בדפדפן: http://localhost:{port}   (עצירה: Ctrl+C)")
    ThreadingHTTPServer(("127.0.0.1", port), H).serve_forever()
