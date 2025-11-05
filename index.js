import WebSocket from 'ws';
import http from 'http';

// =======================================================
// 1. إعدادات تيليقرام
// =======================================================
const BOT_TOKEN = "8284632269:AAF6rgI-k-8gXsvodHWJD0iHpuAP5zDbdno";
const CHAT_ID   = "47654327"; 
const BINANCE_WS_URL = 'wss://stream.binance.com:9443/ws/!miniTicker@arr'; 

// يجب إضافة هذه الدالة في Node.js لأن 'fetch' ليست معرفة بشكل عام بدون استيرادها، 
// لكن في Render/Node.js الحديث قد تعمل دون استيراد.
async function sendToTelegram(message) {
    const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
    const data = {
        chat_id: CHAT_ID,
        text: message
    };

    try {
        const response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(data)
        });
        const result = await response.json();

        if (result.ok === false) {
            console.error("❌ فشل إرسال إشعار إلى تليقرام (API Error):", result.description);
            return;
        }
        console.log("✅ تم إرسال الإشعار إلى تليقرام");
    } catch (err) {
        console.error("❌ فشل إرسال إشعار إلى تليقرام (Fetch Error)", err);
    }
}

// =======================================================
// 2. إعدادات WebSocket والزخم اللحظي
// =======================================================
const MOMENTUM_THRESHOLD_PERCENT_WS = 0.4; // نسبة الارتفاع المطلوبة (0.4%)
const SNAPSHOT_INTERVAL_MS = 30000; // الفترة الزمنية للمقارنة (30 ثانية)

// مخزن عالمي للأسعار (يحتفظ بآخر سعر ووقت لتحديد الزخم)
const PRICE_SNAPSHOTS = {}; 

// =======================================================
// 3. الوظيفة الرئيسية: إدارة WebSocket
// =======================================================
function startScanner() {
    console.log(`📡 بدء الاتصال بـ WebSocket لرصد الزخم اللحظي...`);

    const ws = new WebSocket(BINANCE_WS_URL);

    ws.on('open', () => {
        console.log('✅ تم فتح اتصال WebSocket بنجاح.');
    });

    ws.on('message', (data) => {
        // يتم استقبال بيانات جميع العملات المقترنة بـ USDT في رسالة واحدة كل ثانية
        try {
            const tickers = JSON.parse(data.toString());

            tickers.forEach(ticker => {
                const symbol = ticker.s; 
                const currentPrice = parseFloat(ticker.c);

                // 1. حساب الزخم والمقارنة
                if (PRICE_SNAPSHOTS[symbol] && PRICE_SNAPSHOTS[symbol].lastPrice > 0) {
                    const oldPrice = PRICE_SNAPSHOTS[symbol].lastPrice;
                    const timeDiff = Date.now() - PRICE_SNAPSHOTS[symbol].timestamp; 

                    const change = ((currentPrice - oldPrice) / oldPrice) * 100;

                    // إرسال الإشعار إذا تحقق الارتفاع المطلوب (MOMENTUM_THRESHOLD) خلال فترة كافية (SNAPSHOT_INTERVAL)
                    if (timeDiff >= SNAPSHOT_INTERVAL_MS && change >= MOMENTUM_THRESHOLD_PERCENT_WS) {
                        const targetPrice = (currentPrice * 1.03).toFixed(currentPrice < 1 ? 6 : 4);
                        const message = `🚀 انفجار لحظي! ${symbol}\nارتفاع ${change.toFixed(2)}% خلال ${(timeDiff / 1000).toFixed(1)} ثانية. هدف 3%: ${targetPrice}`;
                        
                        sendToTelegram(message);
                        
                        // تحديث اللقطة لتجنب إرسال إشعار متكرر لنفس الحركة
                        PRICE_SNAPSHOTS[symbol] = {
                            lastPrice: currentPrice,
                            timestamp: Date.now()
                        };
                    }
                }
                
                // 2. تحديث اللقطة (يتم حفظ آخر سعر إغلاق كل 30 ثانية)
                if (!PRICE_SNAPSHOTS[symbol] || Date.now() - PRICE_SNAPSHOTS[symbol].timestamp >= SNAPSHOT_INTERVAL_MS) {
                    PRICE_SNAPSHOTS[symbol] = {
                        lastPrice: currentPrice,
                        timestamp: Date.now()
                    };
                }
            });
        } catch (e) {
            // تجاهل أخطاء التنسيق العرضية
        }
    });

    ws.on('error', (err) => {
        console.error('❌ حدث خطأ في اتصال WebSocket:', err);
    });

    ws.on('close', () => {
        console.warn('⚠️ تم إغلاق اتصال WebSocket. إعادة الاتصال بعد 5 ثوانٍ...');
        setTimeout(startScanner, 5000); // محاولة إعادة الاتصال التلقائية
    });
}


// =======================================================
// 4. تشغيل التطبيق (Node.js/Render)
// =======================================================

console.log("🚀 بدء تطبيق Binance Scanner Node.js...");
startScanner();

// هذا الخادم الصغير يضمن بقاء خدمة Render تعمل دون توقف
const PORT = process.env.PORT || 8000;

http.createServer((req, res) => {
    res.writeHead(200, {'Content-Type': 'text/plain'});
    res.end('Binance Scanner is running via WebSocket...');
}).listen(PORT, () => {
    console.log(`Web server running on port ${PORT}`);
});
