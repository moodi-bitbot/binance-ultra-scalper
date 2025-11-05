require('dotenv').config();
const WebSocket = require('ws');
const axios = require('axios');

const BOT_TOKEN = process.env.BOT_TOKEN || "";
const CHAT_ID = process.env.CHAT_ID || "";

if (!BOT_TOKEN || !CHAT_ID) {
    console.error("✖ BOT_TOKEN أو CHAT_ID غير مضبوطين.");
    process.exit(1);
}

const TOP_SYMBOLS = [
    "BTCUSDT","ETHUSDT","BNBUSDT","XRPUSDT","ADAUSDT",
    "SOLUSDT","DOGEUSDT","DOTUSDT","MATICUSDT","LTCUSDT"
    // أضف باقي الرموز حسب حاجتك (150 رمز لو تحب)
];

const WINDOW_SEC = 20;
const THRESHOLD_PERCENT = 0.4;
const ALERT_COOLDOWN_SEC = 60;
const MAX_STREAMS_PER_WS = 800;

const priceWindows = new Map();
const lastAlertTs = new Map();

async function sendToTelegram(text) {
    const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
    try {
        await axios.post(url, { chat_id: CHAT_ID, text, parse_mode: "HTML" });
        console.log("✅ إشعار تليقرام:", text.split("\n")[0]);
    } catch (err) {
        console.error("❌ خطأ إرسال تليقرام:", err.response?.data || err.message);
    }
}

function makeStreamsUrl(symbols) {
    const parts = symbols.map(s => `${s.toLowerCase()}@aggTrade`);
    return `wss://stream.binance.com:9443/stream?streams=${parts.join('/')}`;
}

function startWsForSymbols(symbols) {
    if (!symbols.length) return;

    const ws = new WebSocket(makeStreamsUrl(symbols));
    console.log("🔗 الاتصال بـ WebSocket لعدد أزواج:", symbols.length);

    ws.on('open', () => console.log("🟢 WebSocket مفتوح"));

    ws.on('message', (raw) => {
        try {
            const msg = JSON.parse(raw.toString());
            const d = msg.data;
            if (!d || !d.s) return;

            const sym = d.s;
            const price = parseFloat(d.p);
            const ts = d.T || Date.now();

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
                    const lastAlert = lastAlertTs.get(sym) || 0;

                    if (change >= THRESHOLD_PERCENT && (Date.now() - lastAlert > ALERT_COOLDOWN_SEC*1000)) {
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

        } catch (err) { /* تجاهل الأخطاء */ }
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

// ================= Main =================
function main() {
    const groups = [];
    for (let i = 0; i < TOP_SYMBOLS.length; i += MAX_STREAMS_PER_WS) {
        groups.push(TOP_SYMBOLS.slice(i, i + MAX_STREAMS_PER_WS));
    }
    groups.forEach(g => startWsForSymbols(g));

    setInterval(() => {
        console.log(`💓 مراقبة ${TOP_SYMBOLS.length} زوج — نوافذ: ${priceWindows.size}`);
    }, 60000);
}

main();
