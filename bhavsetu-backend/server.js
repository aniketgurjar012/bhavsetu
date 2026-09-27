require('dotenv').config();

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const axios = require('axios');
const User = require('./models/user'); // User model import

const app = express();
app.use(express.json({ limit: '20mb' }));
app.use(cors());

// MongoDB Connection (Cloud Database connected)
mongoose.connect('mongodb+srv://aniketgurjar012_db_user:MP47ca1025@cluster0.ru3fkxs.mongodb.net/bhavsetu?appName=Cluster0', {
    useNewUrlParser: true,
    useUnifiedTopology: true
}).then(() => console.log('Database connected successfully! 🚀'))
  .catch(err => console.log('DB Connection Error:', err));

// In-memory storage for OTP
const otpStorage = {};

// 1. Send OTP Route
app.post('/api/send-otp', async (req, res) => {
    const { email } = req.body;
    if (!email) {
        return res.status(400).json({ success: false, message: "Email is required!" });
    }

    const otp = Math.floor(100000 + Math.random() * 900000);
    otpStorage[email] = otp;

    try {
        await axios.post('https://api.brevo.com/v3/smtp/email', {
            sender: { name: "Bhavsetu", email: "aniketgurjar012@gmail.com" },
            to: [{ email: email }],
            subject: "Bhavsetu - Login OTP Verification",
            htmlContent: `<h3>Your OTP for Bhavsetu login is: <b>${otp}</b></h3><p>It is valid for 5 minutes.</p>`
        }, {
            headers: {
                'api-key': process.env.BREVO_API_KEY,
                'content-type': 'application/json'
            }
        });

        console.log(`OTP sent successfully to ${email}`);
        res.json({ success: true, message: "OTP sent successfully!" });
    } catch (error) {
        console.error('Error sending OTP:', error.response?.data || error.message);
        res.status(500).json({ success: false, message: "Failed to send OTP" });
    }
});

// 2. Verify OTP Route (Database me check/create user)
app.post('/api/verify-otp', async (req, res) => {
    const { email, otp } = req.body;
    if (otpStorage[email] && otpStorage[email] == otp) {
        delete otpStorage[email]; 

        let dbUser = await User.findOne({ email });
        if (!dbUser) {
            dbUser = new User({ email });
            await dbUser.save();
        }

        return res.json({ success: true, message: "OTP verified successfully!", user: dbUser });
    }
    res.status(400).json({ success: false, message: "Invalid or expired OTP!" });
});

// 3. Update Profile Route (Cloud pe data save karne ke liye)
app.post('/api/update-profile', async (req, res) => {
    try {
        const { email, name, phone, state, district, village } = req.body;
        let updatedUser = await User.findOneAndUpdate(
            { email },
            { name, phone, state, district, village },
            { new: true, upsert: true }
        );
        res.json({ success: true, user: updatedUser });
    } catch (err) {
        console.error("Update profile error:", err);
        res.status(500).json({ success: false, message: "Server error" });
    }
});

// 4. Get User Profile Route (Kisi bhi device se email ke through data fetch karne ke liye)
app.get('/api/get-profile/:email', async (req, res) => {
    try {
        const user = await User.findOne({ email: req.params.email });
        if (user) {
            res.json({ success: true, user });
        } else {
            res.json({ success: false, message: "User not found" });
        }
    } catch (err) {
        console.error("Get profile error:", err);
        res.status(500).json({ success: false, message: "Server error" });
    }
});

// Server Listen on Port 5000
app.listen(5000, () => {
    console.log('Server is running on port 5000 🚀');
});
app.get('/', (req, res) => {
    res.send('Bhavsetu Server is running!');
});







// ==========================================================
// BHAVSETU MANDI - FAST + PERSISTENT SMALL CACHE
//
// Current prices: latest 3 days
// No Load More
// History: max 5 entries
//
// Only requested districts are cached.
// User model is NOT touched.
// ==========================================================


// ==========================================================
// MONGODB CACHE MODEL
// ==========================================================

const mandiCacheSchema = new mongoose.Schema(
    {
        key: {
            type: String,
            unique: true,
            index: true,
            required: true
        },

        state: {
            type: String,
            required: true
        },

        district: {
            type: String,
            required: true
        },

        markets: {
            type: Array,
            default: []
        },

        updatedAt: {
            type: Date,
            default: Date.now
        },

        expireAt: {
            type: Date,
            required: true
        }
    },
    {
        versionKey: false
    }
);


// Auto-delete after 2 days
mandiCacheSchema.index(
    {
        expireAt: 1
    },
    {
        expireAfterSeconds: 0
    }
);


const MandiFastCache =
    mongoose.models.MandiFastCache ||
    mongoose.model(
        "MandiFastCache",
        mandiCacheSchema
    );


// ==========================================================
// SETTINGS
// ==========================================================

const MANDI_RESOURCE_ID =
    "35985678-0d79-46b4-9ed6-6f13308a1d24";

const MANDI_API_KEY =
    process.env.AGMARKNET_API_KEY;


const MANDI_CACHE_FRESH_MS =
    15 * 60 * 1000;


const MANDI_CACHE_EXPIRE_MS =
    48 * 60 * 60 * 1000;


const mandiPending =
    new Map();


const mandiHistoryMemory =
    new Map();


// ==========================================================
// HELPERS
// ==========================================================

function mandiDateTime(value) {

    if (!value) {
        return 0;
    }


    const parts =
        String(value)
            .trim()
            .split(/[\/-]/);


    if (
        parts.length !== 3
    ) {
        return 0;
    }


    const d =
        new Date(
            Number(parts[2]),
            Number(parts[1]) - 1,
            Number(parts[0])
        );


    return isNaN(
        d.getTime()
    )
        ? 0
        : d.getTime();
}


function mandiDayKey(value) {

    const time =
        mandiDateTime(value);


    if (!time) {
        return "";
    }


    const d =
        new Date(time);


    const dd =
        String(
            d.getDate()
        ).padStart(
            2,
            "0"
        );


    const mm =
        String(
            d.getMonth() + 1
        ).padStart(
            2,
            "0"
        );


    return `${dd}-${mm}-${d.getFullYear()}`;
}


// ==========================================================
// GOVERNMENT API
//
// ONE REQUEST FIRST.
// No 3 parallel date requests.
// ==========================================================

async function fetchMandiGovernment(
    state,
    district
) {

    const params =
        new URLSearchParams();


    params.set(
        "api-key",
        MANDI_API_KEY
    );


    params.set(
        "format",
        "json"
    );


    params.set(
        "limit",
        "1000"
    );


    params.set(
        "offset",
        "0"
    );


    params.set(
        "filters[State]",
        state
    );


    params.set(
        "filters[District]",
        district
    );


    // Ask API for newest records first
    params.set(
        "sort[Arrival_Date]",
        "desc"
    );


    const url =
        `https://api.data.gov.in/resource/${MANDI_RESOURCE_ID}?${params.toString()}`;


    const response =
        await axios.get(
            url,
            {
                timeout: 12000,

                headers: {
                    Accept:
                        "application/json"
                }
            }
        );


    if (
        response.data?.error
    ) {
        throw new Error(
            String(
                response.data.error
            )
        );
    }


    return Array.isArray(
        response.data?.records
    )
        ? response.data.records
        : [];
}


// ==========================================================
// GET LATEST 3 AVAILABLE DATES
//
// Important:
// "3 days" here means latest 3 dates actually available
// in the returned mandi data.
// This avoids blank result on holidays/no-arrival days.
// ==========================================================

function getLatest3MandiDates(
    records
) {

    const dates =
        new Map();


    for (
        const item
        of records
    ) {

        const time =
            mandiDateTime(
                item.Arrival_Date
            );


        if (!time) {
            continue;
        }


        const key =
            mandiDayKey(
                item.Arrival_Date
            );


        if (!key) {
            continue;
        }


        if (
            !dates.has(key)
        ) {

            dates.set(
                key,
                time
            );
        }
    }


    return Array
        .from(
            dates.entries()
        )
        .sort(
            (a, b) =>
                b[1] - a[1]
        )
        .slice(
            0,
            3
        )
        .map(
            item => item[0]
        );
}


// ==========================================================
// PROCESS DATA
// ==========================================================

function processMandiRecords(
    records
) {

    const latestDates =
        new Set(
            getLatest3MandiDates(
                records
            )
        );


    if (
        latestDates.size === 0
    ) {
        return [];
    }


    const selected =
        records.filter(
            item =>
                latestDates.has(
                    mandiDayKey(
                        item.Arrival_Date
                    )
                )
        );


    selected.sort(
        (a, b) =>
            mandiDateTime(
                b.Arrival_Date
            ) -
            mandiDateTime(
                a.Arrival_Date
            )
    );


    const markets =
        new Map();


    for (
        const item
        of selected
    ) {

        const market =
            String(
                item.Market || ""
            ).trim();


        const commodity =
            String(
                item.Commodity || ""
            ).trim();


        const variety =
            String(
                item.Variety || ""
            ).trim();


        if (
            !market ||
            !commodity
        ) {
            continue;
        }


        if (
            !markets.has(
                market
            )
        ) {

            markets.set(
                market,
                {
                    market,

                    latestDate:
                        item.Arrival_Date,

                    records:
                        new Map()
                }
            );
        }


        const marketData =
            markets.get(
                market
            );


        if (
            mandiDateTime(
                item.Arrival_Date
            ) >
            mandiDateTime(
                marketData.latestDate
            )
        ) {

            marketData.latestDate =
                item.Arrival_Date;
        }


        const recordKey =
            `${commodity.toLowerCase()}|${variety.toLowerCase()}`;


        if (
            !marketData
                .records
                .has(
                    recordKey
                )
        ) {

            marketData
                .records
                .set(
                    recordKey,
                    item
                );
        }
    }


    return Array
        .from(
            markets.values()
        )
        .map(
            market => ({

                market:
                    market.market,

                latestDate:
                    market.latestDate,

                records:
                    Array.from(
                        market.records
                            .values()
                    )
            })
        )
        .sort(
            (a, b) =>
                mandiDateTime(
                    b.latestDate
                ) -
                mandiDateTime(
                    a.latestDate
                )
        );
}


// ==========================================================
// SAVE SMALL PROCESSED CACHE
// ==========================================================

async function saveMandiCache(
    state,
    district,
    markets
) {

    // Empty upstream response should not destroy
    // last successful cache.
    if (
        !Array.isArray(markets) ||
        markets.length === 0
    ) {
        return;
    }


    const key =
        `${state}|${district}`
            .toLowerCase();


    const now =
        new Date();


    const expireAt =
        new Date(
            Date.now() +
            MANDI_CACHE_EXPIRE_MS
        );


    await MandiFastCache
        .findOneAndUpdate(
            {
                key
            },

            {
                $set: {
                    state,
                    district,
                    markets,

                    updatedAt:
                        now,

                    expireAt
                }
            },

            {
                upsert: true,
                new: true
            }
        );
}


// ==========================================================
// BACKGROUND REFRESH
// ==========================================================

async function refreshMandi(
    state,
    district
) {

    const key =
        `${state}|${district}`
            .toLowerCase();


    if (
        mandiPending.has(
            key
        )
    ) {

        return mandiPending.get(
            key
        );
    }


    const job =
        (async () => {

            const records =
                await fetchMandiGovernment(
                    state,
                    district
                );


            const markets =
                processMandiRecords(
                    records
                );


            if (
                markets.length
            ) {

                await saveMandiCache(
                    state,
                    district,
                    markets
                );
            }


            return markets;
        })();


    mandiPending.set(
        key,
        job
    );


    try {

        return await job;

    } finally {

        mandiPending.delete(
            key
        );
    }
}


// ==========================================================
// MANDI PRICES
// ==========================================================

app.get(
    "/api/mandi-prices",

    async (
        req,
        res
    ) => {

        res.set(
            "Cache-Control",
            "no-store"
        );


        const state =
            String(
                req.query.state ||
                ""
            ).trim();


        const district =
            String(
                req.query.district ||
                ""
            ).trim();


        if (
            !state ||
            !district
        ) {

            return res
                .status(400)
                .json({
                    success:
                        false,

                    message:
                        "State and district required"
                });
        }


        const key =
            `${state}|${district}`
                .toLowerCase();


        try {

            // ------------------------------------------
            // 1. CHECK MONGODB CACHE
            // ------------------------------------------

            const cached =
                await MandiFastCache
                    .findOne({
                        key
                    })
                    .lean();


            if (
                cached &&
                Array.isArray(
                    cached.markets
                ) &&
                cached.markets.length
            ) {

                const age =
                    Date.now() -
                    new Date(
                        cached.updatedAt
                    ).getTime();


                // Fresh cache
                if (
                    age <
                    MANDI_CACHE_FRESH_MS
                ) {

                    return res.json({
                        success:
                            true,

                        state,

                        district,

                        days:
                            3,

                        markets:
                            cached.markets,

                        cached:
                            true,

                        hasMore:
                            false,

                        nextOffset:
                            null
                    });
                }


                // --------------------------------------
                // OLD CACHE:
                // return immediately
                // refresh silently in background
                // --------------------------------------

                refreshMandi(
                    state,
                    district
                )
                    .catch(
                        error => {

                            console.error(
                                "Mandi background refresh:",
                                error.message
                            );
                        }
                    );


                return res.json({
                    success:
                        true,

                    state,

                    district,

                    days:
                        3,

                    markets:
                        cached.markets,

                    cached:
                        true,

                    refreshing:
                        true,

                    hasMore:
                        false,

                    nextOffset:
                        null
                });
            }


            // ------------------------------------------
            // 2. FIRST REQUEST
            // No saved cache yet.
            // ------------------------------------------

            try {

                const markets =
                    await refreshMandi(
                        state,
                        district
                    );


                return res.json({
                    success:
                        true,

                    state,

                    district,

                    days:
                        3,

                    markets,

                    cached:
                        false,

                    hasMore:
                        false,

                    nextOffset:
                        null
                });


            } catch (upstreamError) {

                console.error(
                    "Mandi Government API:",
                    upstreamError.message
                );


                return res
                    .status(502)
                    .json({
                        success:
                            false,

                        message:
                            "Government mandi API temporarily unavailable"
                    });
            }


        } catch (error) {

            console.error(
                "Mandi endpoint:",
                error
            );


            return res
                .status(500)
                .json({
                    success:
                        false,

                    message:
                        "Mandi service failed"
                });
        }
    }
);


// ==========================================================
// HISTORY
//
// Uses cached 3-day data first.
// Returns max 5 matching date-price values.
// ==========================================================

app.get(
    "/api/mandi-history",

    async (
        req,
        res
    ) => {

        res.set(
            "Cache-Control",
            "no-store"
        );


        const state =
            String(
                req.query.state ||
                ""
            ).trim();


        const district =
            String(
                req.query.district ||
                ""
            ).trim();


        const market =
            String(
                req.query.market ||
                ""
            ).trim();


        const commodity =
            String(
                req.query.commodity ||
                ""
            ).trim();


        const variety =
            String(
                req.query.variety ||
                ""
            ).trim();


        if (
            !state ||
            !district ||
            !market ||
            !commodity
        ) {

            return res
                .status(400)
                .json({
                    success:
                        false,

                    message:
                        "Missing history parameters"
                });
        }


        const historyKey =
            [
                state,
                district,
                market,
                commodity,
                variety
            ]
                .join("|")
                .toLowerCase();


        const memoryCached =
            mandiHistoryMemory.get(
                historyKey
            );


        if (
            memoryCached &&
            Date.now() -
                memoryCached.savedAt <
                30 * 60 * 1000
        ) {

            return res.json(
                memoryCached.data
            );
        }


        try {

            const cacheKey =
                `${state}|${district}`
                    .toLowerCase();


            const cached =
                await MandiFastCache
                    .findOne({
                        key:
                            cacheKey
                    })
                    .lean();


            const history =
                [];


            const seenDates =
                new Set();


            if (
                cached &&
                Array.isArray(
                    cached.markets
                )
            ) {

                const selectedMarket =
                    cached.markets.find(
                        m =>
                            String(
                                m.market || ""
                            )
                                .trim()
                                .toLowerCase() ===
                            market.toLowerCase()
                    );


                if (
                    selectedMarket &&
                    Array.isArray(
                        selectedMarket.records
                    )
                ) {

                    const matching =
                        selectedMarket.records
                            .filter(
                                item =>

                                    String(
                                        item.Commodity ||
                                        ""
                                    )
                                        .trim()
                                        .toLowerCase() ===
                                    commodity.toLowerCase()

                                    &&

                                    String(
                                        item.Variety ||
                                        ""
                                    )
                                        .trim()
                                        .toLowerCase() ===
                                    variety.toLowerCase()
                            )
                            .sort(
                                (a, b) =>
                                    mandiDateTime(
                                        b.Arrival_Date
                                    ) -
                                    mandiDateTime(
                                        a.Arrival_Date
                                    )
                            );


                    for (
                        const item
                        of matching
                    ) {

                        const date =
                            String(
                                item.Arrival_Date ||
                                ""
                            ).trim();


                        if (
                            !date ||
                            seenDates.has(
                                date
                            )
                        ) {
                            continue;
                        }


                        seenDates.add(
                            date
                        );


                        history.push({
                            date,

                            price:
                                item.Modal_Price
                        });


                        if (
                            history.length >=
                            5
                        ) {
                            break;
                        }
                    }
                }
            }


            const result = {
                success:
                    true,

                history:
                    history.slice(
                        0,
                        5
                    ),

                hasMore:
                    false,

                nextOffset:
                    null
            };


            mandiHistoryMemory.set(
                historyKey,
                {
                    savedAt:
                        Date.now(),

                    data:
                        result
                }
            );


            return res.json(
                result
            );


        } catch (error) {

            console.error(
                "Mandi history:",
                error.message
            );


            return res
                .status(500)
                .json({
                    success:
                        false,

                    message:
                        "Mandi history failed"
                });
        }
    }
);




// ===============================
// GEMINI CROP SCANNER API ROUTE
// ===============================
app.post("/api/chat", async (req, res) => {
    try {
        const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
        const model = process.env.GEMINI_MODEL || "gemini-3.8-flash";

        if (!apiKey) {
            return res.status(500).json({ error: "GEMINI_API_KEY is missing in your .env file." });
        }

        const { messages } = req.body;
        const language = ["en", "hi", "mr"].includes(req.body.language) ? req.body.language : "hi";
        if (!Array.isArray(messages) || messages.length === 0) {
            return res.status(400).json({ error: "No messages provided." });
        }

        const responseLanguage = { en: "English", hi: "Hindi in Devanagari script", mr: "Marathi in Devanagari script" }[language];
        const systemInstruction = `You are an agricultural crop-quality visual inspector. Analyze only what is clearly visible in the attached crop photo. Do not infer moisture, hidden properties, or invent findings. Score using this rubric: 90-100 clean and uniform with negligible visible defects; 80-89 good with minor impurities; 60-79 noticeable impurities or defects; 40-59 heavy contamination or poor condition; 0-39 severe visible defects or no crop present.
    Return only a JSON object with exactly these keys: score (integer 0-100), observations (specific visible crop defects or foreign matter), advice (short practical advice based on visible evidence). Write all string values in ${responseLanguage}. Do not return grade, confidence, moisture, markdown, or extra keys.`;

        let userPrompt = "";
        let inlineData = null;

        for (const message of messages) {
            if (message.content) userPrompt += message.content + "\n";
            if (Array.isArray(message.attachments)) {
                for (const att of message.attachments) {
                    if (att.data && att.mimeType) {
                        inlineData = { mime_type: att.mimeType, data: att.data };
                    }
                }
            }
        }

        const parts = [{ text: systemInstruction + "\n\nUser Request: " + userPrompt }];
        if (inlineData) parts.push({ inline_data: inlineData });

        const requestBody = JSON.stringify({
            contents: [{ parts: parts }],
            generationConfig: { responseMimeType: "application/json" }
        });
        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

        let response = await fetch(geminiUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: requestBody
        });

        if (response.status === 429 || response.status === 503) {
            const fallbackModel = process.env.GEMINI_FALLBACK_MODEL || "gemini-3.5-flash-lite";
            const fallbackUrl = `https://generativelanguage.googleapis.com/v1beta/models/${fallbackModel}:generateContent?key=${apiKey}`;
            response = await fetch(fallbackUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: requestBody
            });
        }

        if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            throw new Error(errData.error?.message || "Gemini API request failed.");
        }

        const data = await response.json();
        const aiText = data.candidates?.[0]?.content?.parts?.[0]?.text || "No analysis generated.";

        res.status(200);
        res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");
        res.flushHeaders?.();

        res.write(`data: ${JSON.stringify({ type: "delta", text: aiText })}\n\n`);
        res.write(`data: ${JSON.stringify({ type: "done" })}\n\n`);
        res.end();

    } catch (error) {
        console.error("GEMINI ERROR:", error.message);
        if (!res.headersSent) {
            return res.status(500).json({ error: error.message });
        }
        res.write(`data: ${JSON.stringify({ type: "error", error: error.message })}\n\n`);
        res.end();
    }
});

app.post("/api/crop-disease", async (req, res) => {
    try {
        const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
        const model = process.env.GEMINI_MODEL || "gemini-3.8-flash";
        const { image, mimeType, language } = req.body;

        if (!apiKey) {
            return res.status(500).json({ error: "GEMINI_API_KEY is missing in your .env file." });
        }
        if (!image || !["image/jpeg", "image/png", "image/webp"].includes(mimeType)) {
            return res.status(400).json({ error: "Upload a JPG, PNG, or WebP crop photo." });
        }

        const responseLanguage = {
            en: "English",
            hi: "Hindi in Devanagari script",
            mr: "Marathi in Devanagari script"
        }[language] || "Hindi in Devanagari script";

        const prompt = `You are a careful agricultural crop-disease assistant. Inspect the attached photo of any crop, fruit, or leaf. Identify only visual evidence. Return a possible disease or pest, not a certain diagnosis. If the image is unclear or no disease is visible, say so and do not invent one. Explain visible signs and the likely cause. Give practical, safe next steps; do not invent pesticide dosages and advise local agricultural expert confirmation before chemical treatment. Return only JSON with exactly these string keys: crop, possibleDisease, visibleSigns, likelyCause, solution. Write every value in ${responseLanguage}.`;
        const requestBody = JSON.stringify({
            contents: [{
                parts: [
                    { text: prompt },
                    { inline_data: { mime_type: mimeType, data: image } }
                ]
            }],
            generationConfig: { responseMimeType: "application/json" }
        });

        const sendRequest = selectedModel => fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${selectedModel}:generateContent?key=${apiKey}`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: requestBody
            }
        );

        let response = await sendRequest(model);
        if (response.status === 429 || response.status === 503) {
            response = await sendRequest(process.env.GEMINI_FALLBACK_MODEL || "gemini-3.5-flash-lite");
        }
        if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            throw new Error(errData.error?.message || "Gemini disease analysis failed.");
        }

        const data = await response.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!text) {
            throw new Error("Gemini returned no disease analysis.");
        }

        return res.json(JSON.parse(text));
    } catch (error) {
        console.error("Crop disease analysis:", error.message);
        return res.status(500).json({ error: error.message });
    }
});

function openMeteoCondition(code, language, isDay) {
    const groups = [
        { codes: [0], id: 800, group: "clear" },
        { codes: [1], id: 801, group: "mostlyClear" },
        { codes: [2], id: 802, group: "partlyCloudy" },
        { codes: [3], id: 804, group: "overcast" },
        { codes: [45, 48], id: 741, group: "fog" },
        { codes: [51, 53, 55], id: 301, group: "drizzle" },
        { codes: [56, 57, 66, 67], id: 511, group: "freezingRain" },
        { codes: [61, 63, 65], id: 501, group: "rain" },
        { codes: [71, 73, 75], id: 601, group: "snow" },
        { codes: [77], id: 611, group: "snow" },
        { codes: [80, 81, 82], id: 521, group: "showers" },
        { codes: [85, 86], id: 621, group: "snow" },
        { codes: [95, 96, 99], id: 202, group: "storm" }
    ];
    const group = groups.find(item => item.codes.includes(Number(code))) || groups[3];
    const descriptions = {
        en: { clear: "Clear sky", mostlyClear: "Mostly clear", partlyCloudy: "Partly cloudy", overcast: "Overcast", fog: "Fog", drizzle: "Drizzle", freezingRain: "Freezing rain", rain: "Rain", snow: "Snow", showers: "Rain showers", storm: "Thunderstorm" },
        hi: { clear: "साफ आसमान", mostlyClear: "मुख्यतः साफ", partlyCloudy: "आंशिक बादल", overcast: "घने बादल", fog: "कोहरा", drizzle: "बूंदाबांदी", freezingRain: "जमने वाली बारिश", rain: "बारिश", snow: "बर्फबारी", showers: "बारिश की बौछारें", storm: "आंधी-तूफान" },
        mr: { clear: "निरभ्र आकाश", mostlyClear: "मुख्यतः निरभ्र", partlyCloudy: "अंशतः ढगाळ", overcast: "ढगाळ", fog: "धुके", drizzle: "रिमझिम पाऊस", freezingRain: "गोठणारा पाऊस", rain: "पाऊस", snow: "हिमवृष्टी", showers: "पावसाच्या सरी", storm: "वादळ" }
    };
    const iconFamily = group.id >= 200 && group.id < 300 ? "11" : group.id >= 300 && group.id < 400 ? "09"
        : group.id >= 500 && group.id < 600 ? "10" : group.id >= 600 && group.id < 700 ? "13"
        : group.id >= 700 && group.id < 800 ? "50" : group.id === 800 ? "01"
        : group.id === 801 ? "02" : group.id === 802 ? "03" : "04";
    return {
        id: group.id,
        main: group.group,
        description: descriptions[language]?.[group.group] || descriptions.en[group.group],
        icon: `${iconFamily}${isDay ? "d" : "n"}`
    };
}

async function fetchOpenMeteoWeather(state, district, language) {
    const geocodingUrl = new URL("https://geocoding-api.open-meteo.com/v1/search");
    geocodingUrl.searchParams.set("name", district);
    geocodingUrl.searchParams.set("count", "10");
    geocodingUrl.searchParams.set("language", "en");
    geocodingUrl.searchParams.set("format", "json");
    geocodingUrl.searchParams.set("countryCode", "IN");

    const geocodingResponse = await fetch(geocodingUrl, { signal: AbortSignal.timeout(10000) });
    const geocodingData = await geocodingResponse.json();
    const normalize = value => String(value || "").toLowerCase().replace(/[^a-z]/g, "").replace(/district/g, "");
    const place = (geocodingData.results || []).find(item =>
        item.country_code === "IN" && normalize(item.admin1) === normalize(state) &&
        (normalize(item.admin2).includes(normalize(district)) || normalize(item.name) === normalize(district))
    );
    if (!place) {
        const error = new Error("District not found by Open-Meteo");
        error.code = "WEATHER_DISTRICT_NOT_FOUND";
        throw error;
    }

    const parameters = new URLSearchParams({
        latitude: String(place.latitude),
        longitude: String(place.longitude),
        current: "temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,rain,showers,snowfall,weather_code,cloud_cover,pressure_msl,wind_speed_10m,wind_direction_10m,wind_gusts_10m,dew_point_2m,uv_index,visibility",
        hourly: "temperature_2m,relative_humidity_2m,dew_point_2m,apparent_temperature,precipitation_probability,precipitation,rain,showers,snowfall,weather_code,cloud_cover,pressure_msl,visibility,wind_speed_10m,wind_direction_10m,wind_gusts_10m,uv_index,is_day",
        daily: "weather_code,temperature_2m_max,temperature_2m_min,apparent_temperature_max,apparent_temperature_min,sunrise,sunset,uv_index_max,precipitation_sum,rain_sum,showers_sum,snowfall_sum,precipitation_probability_max,wind_speed_10m_max,wind_gusts_10m_max,wind_direction_10m_dominant,relative_humidity_2m_mean,pressure_msl_mean,cloud_cover_mean",
        timezone: "auto",
        forecast_days: "8",
        temperature_unit: "celsius",
        wind_speed_unit: "ms",
        precipitation_unit: "mm"
    });
    const forecastResponse = await fetch(`https://api.open-meteo.com/v1/forecast?${parameters}`, { signal: AbortSignal.timeout(15000) });
    const source = await forecastResponse.json();
    if (!forecastResponse.ok || source.error) {
        throw new Error("Open-Meteo forecast unavailable");
    }

    const offset = source.utc_offset_seconds || 0;
    const timestamp = value => value ? Math.floor(Date.parse(`${value}Z`) / 1000 - offset) : undefined;
    const at = (series, index) => series?.[index];
    const code = (value, day) => openMeteoCondition(value, language, day === 1);
    const currentData = source.current;
    const weather = {
        timezone: source.timezone || place.timezone || "Asia/Kolkata",
        current: {
            dt: timestamp(currentData.time), sunrise: timestamp(source.daily.sunrise[0]), sunset: timestamp(source.daily.sunset[0]),
            temp: currentData.temperature_2m, feels_like: currentData.apparent_temperature, humidity: currentData.relative_humidity_2m,
            wind_speed: currentData.wind_speed_10m, wind_deg: currentData.wind_direction_10m, wind_gust: currentData.wind_gusts_10m,
            pressure: currentData.pressure_msl, visibility: currentData.visibility, dew_point: currentData.dew_point_2m,
            uvi: currentData.uv_index, clouds: currentData.cloud_cover, rain: { "1h": currentData.precipitation },
            snow: { "1h": (currentData.snowfall || 0) * 10 }, weather: [code(currentData.weather_code, currentData.is_day)]
        },
        hourly: source.hourly.time.map((time, index) => ({
            dt: timestamp(time), temp: at(source.hourly.temperature_2m, index), feels_like: at(source.hourly.apparent_temperature, index),
            humidity: at(source.hourly.relative_humidity_2m, index), dew_point: at(source.hourly.dew_point_2m, index),
            wind_speed: at(source.hourly.wind_speed_10m, index), wind_deg: at(source.hourly.wind_direction_10m, index),
            wind_gust: at(source.hourly.wind_gusts_10m, index), pressure: at(source.hourly.pressure_msl, index),
            visibility: at(source.hourly.visibility, index), uvi: at(source.hourly.uv_index, index), clouds: at(source.hourly.cloud_cover, index),
            pop: (at(source.hourly.precipitation_probability, index) || 0) / 100,
            rain: { "1h": at(source.hourly.precipitation, index) }, snow: { "1h": (at(source.hourly.snowfall, index) || 0) * 10 },
            weather: [code(at(source.hourly.weather_code, index), at(source.hourly.is_day, index))]
        })),
        daily: source.daily.time.map((date, index) => ({
            dt: timestamp(`${date}T12:00`), sunrise: timestamp(source.daily.sunrise[index]), sunset: timestamp(source.daily.sunset[index]),
            temp: { min: at(source.daily.temperature_2m_min,index), max: at(source.daily.temperature_2m_max,index), morn: undefined, day: at(source.daily.temperature_2m_max,index), eve: undefined, night: undefined },
            feels_like: { day: at(source.daily.apparent_temperature_max,index) }, humidity: at(source.daily.relative_humidity_2m_mean,index),
            pressure: at(source.daily.pressure_msl_mean,index), clouds: at(source.daily.cloud_cover_mean,index), uvi: at(source.daily.uv_index_max,index),
            pop: (at(source.daily.precipitation_probability_max,index)||0)/100,
            rain: at(source.daily.precipitation_sum,index), snow: (at(source.daily.snowfall_sum,index)||0)*10,
            wind_speed: at(source.daily.wind_speed_10m_max,index), wind_gust: at(source.daily.wind_gusts_10m_max,index),
            wind_deg: at(source.daily.wind_direction_10m_dominant,index), weather: [code(at(source.daily.weather_code,index),1)]
        })),
        alerts: []
    };
    return { provider: "Open-Meteo", location: { name: place.name, state: place.admin1 || state, district }, weather };
}

const openWeatherCache = new Map();

app.get("/api/weather", async (req, res) => {
    const state = String(req.query.state || "").trim();
    const district = String(req.query.district || "").trim();
    const language = ["en", "hi", "mr"].includes(req.query.language) ? req.query.language : "hi";
    const apiKey = process.env.OPENWEATHER_API_KEY;

    if (!state || !district || state.length > 100 || district.length > 100) {
        return res.status(400).json({ success: false, code: "WEATHER_LOCATION_REQUIRED" });
    }

    const cacheKey = `${state}|${district}|${language}`.toLowerCase();
    const cached = openWeatherCache.get(cacheKey);
    if (cached && Date.now() - cached.savedAt < 10 * 60 * 1000) {
        return res.json({ success: true, cached: true, ...cached.payload });
    }

    if (!apiKey) {
        try {
            const payload = await fetchOpenMeteoWeather(state, district, language);
            openWeatherCache.set(cacheKey, { savedAt: Date.now(), payload });
            return res.json({ success: true, cached: false, ...payload });
        } catch (error) {
            console.error("Open-Meteo fallback:", error.message);
            return res.status(error.code === "WEATHER_DISTRICT_NOT_FOUND" ? 404 : 502).json({
                success: false,
                code: error.code || "WEATHER_UPSTREAM_FAILED"
            });
        }
    }

    try {
        const geoUrl = new URL("https://api.openweathermap.org/geo/1.0/direct");
        geoUrl.searchParams.set("q", `${district},${state},IN`);
        geoUrl.searchParams.set("limit", "1");
        geoUrl.searchParams.set("appid", apiKey);

        const geoResponse = await fetch(geoUrl, { signal: AbortSignal.timeout(10000) });
        const places = await geoResponse.json();
        if (!geoResponse.ok) {
            const status = geoResponse.status === 401 ? 503 : 502;
            const code = geoResponse.status === 401 ? "WEATHER_KEY_INVALID" : "WEATHER_GEOCODING_FAILED";
            return res.status(status).json({ success: false, code });
        }

        const place = Array.isArray(places)
            ? places.find(item => item.country === "IN")
            : null;
        if (!place) {
            return res.status(404).json({ success: false, code: "WEATHER_DISTRICT_NOT_FOUND" });
        }

        const weatherUrl = new URL("https://api.openweathermap.org/data/3.0/onecall");
        weatherUrl.searchParams.set("lat", place.lat);
        weatherUrl.searchParams.set("lon", place.lon);
        weatherUrl.searchParams.set("units", "metric");
        weatherUrl.searchParams.set("lang", language === "mr" ? "en" : language);
        weatherUrl.searchParams.set("appid", apiKey);

        const weatherResponse = await fetch(weatherUrl, { signal: AbortSignal.timeout(15000) });
        const weather = await weatherResponse.json();
        if (!weatherResponse.ok) {
            const code = weatherResponse.status === 401 ? "WEATHER_SUBSCRIPTION_REQUIRED"
                : weatherResponse.status === 429 ? "WEATHER_RATE_LIMITED"
                : "WEATHER_UPSTREAM_FAILED";
            return res.status(weatherResponse.status === 429 ? 429 : 502).json({ success: false, code });
        }

        const payload = {
            provider: "OpenWeather",
            location: { name: place.name, state: place.state || state, district },
            weather
        };
        openWeatherCache.set(cacheKey, { savedAt: Date.now(), payload });
        if (openWeatherCache.size > 250) {
            const oldestKey = openWeatherCache.keys().next().value;
            openWeatherCache.delete(oldestKey);
        }
        return res.json({ success: true, cached: false, ...payload });
    } catch (error) {
        console.error("OpenWeather request:", error.message);
        const timedOut = error.name === "TimeoutError" || error.name === "AbortError";
        return res.status(timedOut ? 504 : 502).json({
            success: false,
            code: timedOut ? "WEATHER_TIMEOUT" : "WEATHER_UPSTREAM_FAILED"
        });
    }
});

app.use((error, req, res, next) => {
    if (error.type === "entity.too.large") {
        return res.status(413).json({
            error: "Image request is too large. Please choose a smaller photo (under 15 MB)."
        });
    }

    next(error);
});