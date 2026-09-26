require('dotenv').config();

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const axios = require('axios');
const User = require('./models/user'); // User model import

const app = express();
app.use(express.json());
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