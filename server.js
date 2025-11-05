// server.js — Ultra scalper detector (Binance aggTrade -> Telegram)
// Requires: axios, ws, dotenv
require('dotenv').config();
const axios = require('axios');
const WebSocket = require('ws');

// ================== CONFIG ==================
const BOT_TOKEN = process.env.BOT_TOKEN || "";
const CHAT_ID   = process.env.CHAT_ID   || "";

if (!BOT_TOKEN || !CHAT_ID) {
    console.error("✖ BOT_TOKEN أو CHAT_ID غير مضبوطين. ضعهما في Environment Variables على Render.");
    process.exit(1);
}

const BINANCE_REST = "https://api.binance.com/api/v3";

const TOP_N = process.env.TOP_N ? parseInt(process.env.TOP_N) : 150; // عدد الأزواج الأعلى بالحجم
const WINDOW_SEC = process.env.WINDOW_SEC ? parseInt(process.env.WINDOW_SEC) : 20; // النافذة الزمنية (بالثواني)
const THRESHOLD_PERCENT = process.env.THRESHOLD_PERCENT ? parseFloat(process.env.THRESHOLD_PERCENT) : 0.4; // نسبة الإنذار
const ALERT_COOLDOWN_SEC = process.env.ALERT_COOLDOWN_SEC ? parseInt(process.env.ALERT_COOLDOWN_SEC) : 60; // كولداون للرمز
const MAX_STREAMS_PER_WS = 800; // حد آمن للـ WebSocket

// ================ Helper: Send Telegram ================
async function sendToTelegram(text) {
    const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
    try {
        await axios.post(url, {
            chat_id: CHAT_ID,
            text,
            parse_mode: "HTML"
        });
        console.log("✅ إشعار تليقرام:", text.split("\n")[0]);
    } catch (err) {
        console.error("❌ خطأ إرسال تليقرام:", err.response ? err.response.data : err.message);
    }
}

// ================ State ================
const priceWindows = new Map(); // symbol -> [{ts, price}]
const lastAlertTs = new Map();  // symbol -> timestamp

// ================ Fetch top USDT symbols ================
async function fetchTopUsdtSymbols(limit = TOP_N) {
    try {
        const res = await axios.get(`${BINANCE_REST}/ticker/24hr`);
        const all = res.data;

        const usdt = all
            .filter(it => it.symbol.endsWith("USDT"))
            .map(it => ({
                symbol: it.symbol,
                quoteVolume: parseFloat(it.quoteVolume || 0)
            }))
            .sort((a,b) => b.quoteVolume - a.quoteVolume)
            .slice(0, limit)
            .map(it => it.symbol);

        return usdt;
    } catch (err) {
        console.error("❌ خطأ في جلب 24hr tickers:", err.message);
        throw err;
    }
}

// ================ WebSocket handling ================
function makeStreamsUrl(symbols) {
    const parts = symbols.map(s => `${s.toLowerCase()}@aggTrade`);
    return `wss://stream.binance.com:9443/stream?streams=${parts.join('/')}`;
}

function startWsForSymbols(symbols) {
    if (!symbols.length) return;

    const url = makeStreamsUrl(symbols);
    console.log("🔗 الاتصال بـ WebSocket لعدد أزواج:", symbols.length);

    const ws = new WebSocket(url);

    ws.on('open', () => console.log("🟢 WebSocket مفتوح"));

    ws.on('message', (raw) => {
        try {
            const msg = JSON.parse(raw.toString());
            const d = msg.data;
            if (!d || !d.s) return;

            const sym = d.s;
            const price = parseFloat(d.p);
            const ts = d.T || Date.now();

            // حفظ البيانات
            if (!priceWindows.has(sym)) priceWindows.set(sym, []);
            const arr = priceWindows.get(sym);

            arr.push({ ts, price });

            const cutoff = Date.now() - WINDOW_SEC*1000;
            while (arr.length && arr[0].ts < cutoff) arr.shift();

            if (arr.length >= 2) {
                const oldest = arr[0].price;
                const newest = arr[arr.length - 1].price;

                if (oldest > 0) {
                    const change = ((newest - oldest) / oldest) * 100;

                    if (change >= THRESHOLD_PERCENT) {
                        const lastAlert = lastAlertTs.get(sym) || 0;

                        if (Date.now() - lastAlert > ALERT_COOLDOWN_SEC*1000) {
                            lastAlertTs.set(sym, Date.now());

                            const target = newest * 1.03;
                            const msgText = 
`🚨 <b>${sym}</b>
ارتفاع: ${change.toFixed(2)}% خلال ${WINDOW_SEC}s
السعر الآن: ${newest}
هدف (تقريبي): ${target.toFixed(newest < 1 ? 6 : 4)}`;

                            console.log("🔔 إنذار:", sym, change.toFixed(2) + "%");
                            sendToTelegram(msgText);
                        }
                    }
                }
            }

        } catch (err) {
            // تجاهل الأخطاء البسيطة
        }
    });

    ws.on('close', () => {
        console.warn("⚠️ WebSocket مغلق، إعادة الاتصال...");
        setTimeout(() => startWsForSymbols(symbols), 2000);
    });

    ws.on('error', (e) => {
        console.error("❌ WebSocket Error:", e.message);
        ws.terminate();
    });
}

// ================ Main ================
async function main() {
    try {
        console.log("⏳ جلب أفضل أزواج USDT...");
        const topSymbols = await fetchTopUsdtSymbols();

        console.log(`✅ تم اختيار ${topSymbols.length} زوج.`);

        const groups = [];
        for (let i = 0; i < topSymbols.length; i += MAX_STREAMS_PER_WS) {
            groups.push(topSymbols.slice(i, i + MAX_STREAMS_PER_WS));
        }

        groups.forEach(g => startWsForSymbols(g));

        setInterval(() => {
            console.log(`💓 مراقبة ${topSymbols.length} زوج — نوافذ: ${priceWindows.size}`);
        }, 60000);

    } catch (err) {
        console.error("❌ خطأ في main:", err.message);
        setTimeout(main, 3000);
    }
}

main();
