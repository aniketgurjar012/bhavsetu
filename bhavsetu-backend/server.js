require('dotenv').config();

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const axios = require('axios');
const path = require('path');
const User = require('./models/user');

const app = express();

app.use(express.json({ limit: '20mb' }));
app.use(cors());

// Serve BhavSetu frontend
app.use(express.static(path.join(__dirname, '..')));

// Open index.html on http://localhost:5000/
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'index.html'));
});

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
// BHAVSETU MANDI - AGMARKNET 2.0
// ==========================================================

const mandiCacheSchema = new mongoose.Schema({
    key:{type:String,unique:true,index:true,required:true},
    state:{type:String,required:true},
    district:{type:String,required:true},
    market:{type:String,required:true},
    markets:{type:Array,default:[]},
    updatedAt:{type:Date,default:Date.now},
    expireAt:{type:Date,required:true}
},{versionKey:false});

mandiCacheSchema.index(
    {expireAt:1},
    {expireAfterSeconds:0}
);

const MandiFastCache =
    mongoose.models.MandiFastCache ||
    mongoose.model(
        "MandiFastCache",
        mandiCacheSchema
    );

const AGMARKNET_API =
    "https://api.agmarknet.gov.in/v1";

const MANDI_CACHE_FRESH =
    15 * 60 * 1000;

const MANDI_CACHE_EXPIRE =
    48 * 60 * 60 * 1000;

const mandiPending =
    new Map();

let mandiMasterCache = null;
let mandiMasterTime = 0;

const AG_HEADERS = {
    accept:"application/json, text/plain, */*",
    "content-type":"application/json",
    origin:"https://agmarknet.gov.in",
    referer:"https://agmarknet.gov.in/",
    "user-agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140 Safari/537.36"
};


// ==========================================================
// INDIA DATE
// ==========================================================

function mandiIndiaDate(){

    const parts =
        new Intl.DateTimeFormat(
            "en-CA",
            {
                timeZone:"Asia/Kolkata",
                year:"numeric",
                month:"2-digit",
                day:"2-digit"
            }
        ).formatToParts(new Date());

    const get =
        type =>
            parts.find(
                x => x.type === type
            )?.value;

    return (
        get("year") +
        "-" +
        get("month") +
        "-" +
        get("day")
    );
}


// ==========================================================
// AGMARKNET MASTER
// ==========================================================

async function getMandiMaster(){

    if (
        mandiMasterCache &&
        Date.now() - mandiMasterTime <
        60 * 60 * 1000
    ) {
        return mandiMasterCache;
    }

    const response =
        await fetch(
            AGMARKNET_API +
            "/dashboard-filters/?dashboard_name=marketwise_price_arrival",
            {
                headers:AG_HEADERS
            }
        );

    if (!response.ok) {
        throw new Error(
            "AGMARKNET location HTTP " +
            response.status
        );
    }

    const json =
        await response.json();

    if (!json.data) {
        throw new Error(
            "AGMARKNET location data unavailable"
        );
    }

    mandiMasterCache =
        json.data;

    mandiMasterTime =
        Date.now();

    return mandiMasterCache;
}


// ==========================================================
// STATE → DISTRICT → MARKET LIST
//
// IMPORTANT:
// Names are not renamed here.
// API/master names are returned as-is.
// ==========================================================

app.get(
    "/api/mandi-locations",
    async (req,res) => {

        res.set(
            "Cache-Control",
            "no-store"
        );

        try {

            const master =
                await getMandiMaster();

            const states =
                (master.state_data || [])
                    .filter(
                        x =>
                            Number(x.state_id) >= 1 &&
                            Number(x.state_id) <= 36
                    )
                    .map(
                        x => ({
                            id:Number(x.state_id),
                            name:x.state_name
                        })
                    );

            const markets =
                (master.market_data || [])
                    .filter(
                        x =>
                            x.state_id != null &&
                            x.district_id != null
                    )
                    .map(
                        x => ({
                            id:Number(x.id),
                            name:x.mkt_name,
                            stateId:Number(x.state_id),
                            districtId:Number(x.district_id)
                        })
                    );

            let districts = [];

            if (
                Array.isArray(
                    master.district_data
                )
            ) {

                districts =
                    master.district_data
                        .map(
                            x => ({
                                id:Number(
                                    x.district_id ??
                                    x.dist_id ??
                                    x.id
                                ),

                                stateId:Number(
                                    x.state_id
                                ),

                                name:
                                    x.district_name ??
                                    x.dist_name ??
                                    x.name
                            })
                        )
                        .filter(
                            x =>
                                x.id &&
                                x.stateId &&
                                x.name
                        );
            }

            /*
             * Some AGMARKNET responses may not expose
             * district_data in dashboard-filters.
             *
             * In that situation the endpoint cannot invent
             * district names.
             *
             * If your current response already contains
             * districts (as you tested), this path isn't used.
             */

            res.json({
                success:true,
                states,
                districts,
                markets
            });

        } catch(error) {

            console.error(
                "Mandi locations:",
                error.message
            );

            res.status(502).json({
                success:false,
                message:
                    "Mandi locations unavailable"
            });
        }
    }
);


// ==========================================================
// AGMARKNET LIVE DATA
// ==========================================================

async function fetchAgmarkMandi(
    stateId,
    districtId,
    marketId
){

    const payload = {
        dashboard:
            "marketwise_price_arrival",

        date:
            mandiIndiaDate(),

        group:
            [100000],

        commodity:
            [100001],

        variety:
            100021,

        state:
            Number(stateId),

        district:
            [Number(districtId)],

        market:
            [Number(marketId)],

        grades:
            [4],

        limit:
            100,

        format:
            "json"
    };

    const response =
        await fetch(
            AGMARKNET_API +
            "/dashboard-data/",
            {
                method:"POST",

                headers:
                    AG_HEADERS,

                body:
                    JSON.stringify(
                        payload
                    )
            }
        );

    const raw =
        await response.text();

    if (!response.ok) {

        throw new Error(
            "AGMARKNET HTTP " +
            response.status +
            ": " +
            raw.slice(0,250)
        );
    }

    let json;

    try {
        json =
            JSON.parse(raw);
    } catch {
        throw new Error(
            "Invalid AGMARKNET response"
        );
    }

    if (
        json.status !==
        "success"
    ) {

        throw new Error(
            json.message ||
            "AGMARKNET request failed"
        );
    }

    return json;
}


// ==========================================================
// CONVERT TO BHAVSETU FORMAT
// ==========================================================

function convertAgmarkMandi(
    json,
    marketName
){

    const records =
        json?.data?.records || [];

    const columns =
        json?.data?.columns || [];

    const priceColumns =
        columns.find(
            x =>
                x.key ===
                "price_group"
        )?.columns || [];

    const latestDate =
        priceColumns[0]?.title || "";

    const previousDate =
        priceColumns[1]?.title || "";

    const oldDate =
        priceColumns[2]?.title || "";

    return [{
        market:
            marketName,

        latestDate,

        records:
            records.map(
                x => ({

                    Commodity:
                        x.cmdt_name,

                    Commodity_Group:
                        x.cmdt_grp_name,

                    MSP:
                        x.msp_price,

                    Modal_Price:
                        x.as_on_price,

                    Arrival:
                        x.as_on_arrival,

                    Arrival_Date:
                        latestDate,

                    Previous_Price:
                        x.one_day_ago_price,

                    Previous_Arrival:
                        x.one_day_ago_arrival,

                    Previous_Date:
                        previousDate,

                    Old_Price:
                        x.two_day_ago_price,

                    Old_Arrival:
                        x.two_day_ago_arrival,

                    Old_Date:
                        oldDate,

                    Trend:
                        x.trend
                })
            )
    }];
}


// ==========================================================
// REFRESH + CACHE
// ==========================================================

async function refreshMandiData(
    stateId,
    districtId,
    marketId,
    stateName,
    districtName,
    marketName
){

    const key =
        `${stateId}|${districtId}|${marketId}`;

    if (
        mandiPending.has(key)
    ) {
        return mandiPending.get(key);
    }

    const task =
        (async () => {

            const json =
                await fetchAgmarkMandi(
                    stateId,
                    districtId,
                    marketId
                );

            const markets =
                convertAgmarkMandi(
                    json,
                    marketName
                );

            const hasRecords =
                markets.some(
                    x =>
                        Array.isArray(
                            x.records
                        ) &&
                        x.records.length
                );

            if (hasRecords) {

                await MandiFastCache
                    .findOneAndUpdate(
                        {key},

                        {
                            $set:{
                                state:
                                    stateName,

                                district:
                                    districtName,

                                market:
                                    marketName,

                                markets,

                                updatedAt:
                                    new Date(),

                                expireAt:
                                    new Date(
                                        Date.now() +
                                        MANDI_CACHE_EXPIRE
                                    )
                            }
                        },

                        {
                            upsert:true,
                            new:true
                        }
                    );
            }

            return markets;
        })();

    mandiPending.set(
        key,
        task
    );

    try {
        return await task;
    } finally {
        mandiPending.delete(key);
    }
}


// ==========================================================
// PRICES ENDPOINT
// ==========================================================

app.get(
    "/api/mandi-prices",
    async (req,res) => {

        res.set(
            "Cache-Control",
            "no-store"
        );

        const stateId =
            Number(
                req.query.stateId
            );

        const districtId =
            Number(
                req.query.districtId
            );

        const marketId =
            Number(
                req.query.marketId
            );

        if (
            !stateId ||
            !districtId ||
            !marketId
        ) {

            return res
                .status(400)
                .json({
                    success:false,
                    message:
                        "State, district and market required"
                });
        }

        try {

            const master =
                await getMandiMaster();

            const state =
                (master.state_data || [])
                    .find(
                        x =>
                            Number(
                                x.state_id
                            ) ===
                            stateId
                    );

            const market =
                (master.market_data || [])
                    .find(
                        x =>
                            Number(x.id) ===
                                marketId
                            &&
                            Number(x.state_id) ===
                                stateId
                            &&
                            Number(x.district_id) ===
                                districtId
                    );

            if (
                !state ||
                !market
            ) {

                return res
                    .status(400)
                    .json({
                        success:false,
                        message:
                            "Invalid mandi selection"
                    });
            }

            const stateName =
                state.state_name;

            const districtName =
                String(
                    req.query.district ||
                    ""
                ).trim();

            const marketName =
                market.mkt_name;

            const key =
                `${stateId}|${districtId}|${marketId}`;

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

                if (
                    age <
                    MANDI_CACHE_FRESH
                ) {

                    return res.json({
                        success:true,
                        cached:true,
                        markets:
                            cached.markets
                    });
                }

                refreshMandiData(
                    stateId,
                    districtId,
                    marketId,
                    stateName,
                    districtName,
                    marketName
                ).catch(
                    error =>
                        console.error(
                            "Mandi background refresh:",
                            error.message
                        )
                );

                return res.json({
                    success:true,
                    cached:true,
                    refreshing:true,
                    markets:
                        cached.markets
                });
            }

            const markets =
                await refreshMandiData(
                    stateId,
                    districtId,
                    marketId,
                    stateName,
                    districtName,
                    marketName
                );

            return res.json({
                success:true,
                cached:false,
                markets
            });

        } catch(error) {

            console.error(
                "Mandi prices:",
                error.message
            );

            return res
                .status(502)
                .json({
                    success:false,
                    message:
                        "AGMARKNET mandi service temporarily unavailable"
                });
        }
    }
);


// ==========================================================
// HISTORY - CURRENT 3 REPORTING DATES
// ==========================================================

app.get(
    "/api/mandi-history",
    async (req,res) => {

        res.set(
            "Cache-Control",
            "no-store"
        );

        const stateId =
            Number(
                req.query.stateId
            );

        const districtId =
            Number(
                req.query.districtId
            );

        const marketId =
            Number(
                req.query.marketId
            );

        const commodity =
            String(
                req.query.commodity ||
                ""
            ).trim();

        if (
            !stateId ||
            !districtId ||
            !marketId ||
            !commodity
        ) {

            return res
                .status(400)
                .json({
                    success:false,
                    message:
                        "Missing history parameters"
                });
        }

        try {

            const key =
                `${stateId}|${districtId}|${marketId}`;

            const cached =
                await MandiFastCache
                    .findOne({
                        key
                    })
                    .lean();

            const market =
                cached?.markets?.[0];

            const item =
                market?.records?.find(
                    x =>
                        String(
                            x.Commodity ||
                            ""
                        )
                            .trim()
                            .toLowerCase()
                        ===
                        commodity
                            .toLowerCase()
                );

            if (!item) {

                return res.json({
                    success:true,
                    history:[]
                });
            }

            const history = [
                {
                    date:
                        item.Arrival_Date,

                    price:
                        item.Modal_Price
                },

                {
                    date:
                        item.Previous_Date,

                    price:
                        item.Previous_Price
                },

                {
                    date:
                        item.Old_Date,

                    price:
                        item.Old_Price
                }
            ].filter(
                x =>
                    x.date &&
                    x.price !== null &&
                    x.price !== undefined &&
                    x.price !== ""
            );

            return res.json({
                success:true,
                history
            });

        } catch(error) {

            console.error(
                "Mandi history:",
                error.message
            );

            return res
                .status(500)
                .json({
                    success:false,
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