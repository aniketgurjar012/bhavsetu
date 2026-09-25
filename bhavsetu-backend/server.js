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
// BHAVSETU MANDI - FAST / LAZY LOAD
// Initial: 3 days
// Load More: next 10 days
// History: exact market + crop + variety
// RAM cache only
// ==========================================================

const mandiCache = new Map();
const mandiPending = new Map();

const MANDI_RESOURCE_ID =
    "35985678-0d79-46b4-9ed6-6f13308a1d24";

const MANDI_API_KEY =
    process.env.AGMARKNET_API_KEY ||
    "579b464db66ec23bdd0000015a9fed0d92794b2374297ff3b6e5fdc7";

const MANDI_PAGE_SIZE = 1000;

const MANDI_CACHE_MS =
    30 * 60 * 1000;

const MANDI_HISTORY_CACHE_MS =
    30 * 60 * 1000;

const MANDI_MAX_DAYS = 93;

const mandiHistoryCache =
    new Map();


// ==========================================================
// HELPERS
// ==========================================================

function mandiSleep(ms) {
    return new Promise(
        resolve => setTimeout(resolve, ms)
    );
}


function mandiDateString(date) {

    const dd =
        String(date.getDate())
            .padStart(2, "0");

    const mm =
        String(date.getMonth() + 1)
            .padStart(2, "0");

    const yyyy =
        date.getFullYear();

    return `${dd}-${mm}-${yyyy}`;
}


function mandiDateTime(value) {

    if (!value) return 0;

    const parts =
        String(value)
            .trim()
            .split(/[\/-]/);

    if (parts.length !== 3) {
        return 0;
    }

    const date =
        new Date(
            Number(parts[2]),
            Number(parts[1]) - 1,
            Number(parts[0])
        );

    return isNaN(date.getTime())
        ? 0
        : date.getTime();
}


function getMandiDateByOffset(offset) {

    const date =
        new Date();

    date.setHours(
        0,
        0,
        0,
        0
    );

    date.setDate(
        date.getDate() - offset
    );

    return mandiDateString(date);
}


// ==========================================================
// RAM CACHE CLEANUP
// Keeps memory bounded
// ==========================================================

function cleanupMandiCache() {

    const now =
        Date.now();

    for (
        const [key, value]
        of mandiCache.entries()
    ) {

        if (
            now - value.savedAt >
            MANDI_CACHE_MS
        ) {
            mandiCache.delete(key);
        }
    }


    for (
        const [key, value]
        of mandiHistoryCache.entries()
    ) {

        if (
            now - value.savedAt >
            MANDI_HISTORY_CACHE_MS
        ) {
            mandiHistoryCache.delete(key);
        }
    }


    // Hard safety limits
    while (
        mandiCache.size > 150
    ) {

        const first =
            mandiCache.keys().next().value;

        mandiCache.delete(first);
    }


    while (
        mandiHistoryCache.size > 300
    ) {

        const first =
            mandiHistoryCache
                .keys()
                .next()
                .value;

        mandiHistoryCache.delete(first);
    }
}


// ==========================================================
// GOVERNMENT API REQUEST
// ==========================================================

async function mandiApiGet(url) {

    let lastError;


    for (
        let attempt = 0;
        attempt < 3;
        attempt++
    ) {

        try {

            return await axios.get(
                url,
                {
                    timeout: 20000
                }
            );

        } catch (error) {

            lastError = error;


            const rateLimited =
                error.response?.status === 429 ||
                error.response?.data?.error ===
                    "Rate limit exceeded";


            const timeout =
                error.code === "ECONNABORTED" ||
                String(
                    error.message || ""
                )
                    .toLowerCase()
                    .includes("timeout");


            if (
                !rateLimited &&
                !timeout
            ) {
                throw error;
            }


            if (attempt < 2) {

                await mandiSleep(
                    rateLimited
                        ? 1200 * (attempt + 1)
                        : 500 * (attempt + 1)
                );
            }
        }
    }


    throw lastError;
}


// ==========================================================
// FETCH ONE DATE COMPLETELY
// 1000 is page size, not total limit
// ==========================================================

async function fetchMandiOneDate(
    state,
    district,
    date
) {

    const all = [];

    let offset = 0;


    while (true) {

        const url =
            `https://api.data.gov.in/resource/${MANDI_RESOURCE_ID}` +
            `?api-key=${encodeURIComponent(MANDI_API_KEY)}` +
            `&format=json` +
            `&limit=${MANDI_PAGE_SIZE}` +
            `&offset=${offset}` +
            `&filters[State]=${encodeURIComponent(state)}` +
            `&filters[District]=${encodeURIComponent(district)}` +
            `&filters[Arrival_Date]=${encodeURIComponent(date)}`;


        const response =
            await mandiApiGet(url);


        const records =
            Array.isArray(
                response.data?.records
            )
                ? response.data.records
                : [];


        all.push(...records);


        if (
            records.length <
            MANDI_PAGE_SIZE
        ) {
            break;
        }


        offset += records.length;


        await mandiSleep(80);
    }


    return all;
}


// ==========================================================
// FETCH DATE RANGE
// offsetDays = start day
// days = number of days
// ==========================================================

async function fetchMandiDays(
    state,
    district,
    offsetDays,
    days
) {

    const all = [];

    const end =
        Math.min(
            offsetDays + days,
            MANDI_MAX_DAYS
        );


    /*
     * Only 2 Government requests simultaneously.
     */

    for (
        let i = offsetDays;
        i < end;
        i += 2
    ) {

        const offsets =
            [i, i + 1]
                .filter(
                    value =>
                        value < end
                );


        const results =
            await Promise.all(
                offsets.map(
                    async dayOffset => {

                        const date =
                            getMandiDateByOffset(
                                dayOffset
                            );


                        try {

                            return await fetchMandiOneDate(
                                state,
                                district,
                                date
                            );

                        } catch (error) {

                            console.warn(
                                `Mandi ${date} failed:`,
                                error.response?.data?.error ||
                                error.message
                            );

                            return [];
                        }
                    }
                )
            );


        for (
            const records
            of results
        ) {

            all.push(...records);
        }


        if (i + 2 < end) {
            await mandiSleep(100);
        }
    }


    return {
        records: all,
        nextOffset: end,
        hasMore:
            end < MANDI_MAX_DAYS
    };
}


// ==========================================================
// PROCESS RANGE RECORDS
// Group by market.
// Same market + commodity + variety => latest only.
// ==========================================================

function processMandiCards(
    records
) {

    records.sort(
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


    for (const item of records) {

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


        if (!markets.has(market)) {

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
            markets.get(market);


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


        const key =
            `${commodity.toLowerCase()}|${variety.toLowerCase()}`;


        if (
            !marketData.records.has(key)
        ) {

            marketData.records.set(
                key,
                item
            );
        }
    }


    const result = [];


    for (
        const market
        of markets.values()
    ) {

        result.push({

            market:
                market.market,

            latestDate:
                market.latestDate,

            records:
                Array.from(
                    market.records.values()
                )
        });
    }


    result.sort(
        (a, b) => {

            const diff =
                mandiDateTime(
                    b.latestDate
                ) -
                mandiDateTime(
                    a.latestDate
                );

            if (diff !== 0) {
                return diff;
            }

            return a.market.localeCompare(
                b.market
            );
        }
    );


    return result;
}


// ==========================================================
// INITIAL / LOAD MORE ENDPOINT
//
// Initial:
// /api/mandi-prices?...&offset=0&days=3
//
// Load more:
// offset=3&days=10
// offset=13&days=10
// etc.
// ==========================================================

app.get(
    "/api/mandi-prices",
    async (req, res) => {

        cleanupMandiCache();


        const state =
            String(
                req.query.state || ""
            ).trim();

        const district =
            String(
                req.query.district || ""
            ).trim();


        let offset =
            Number(
                req.query.offset || 0
            );

        let days =
            Number(
                req.query.days || 3
            );


        if (
            !state ||
            !district
        ) {

            return res.status(400).json({
                success: false,
                message:
                    "State and district required"
            });
        }


        if (
            !Number.isFinite(offset) ||
            offset < 0
        ) {
            offset = 0;
        }


        /*
         * Initial = 3
         * Load More = 10
         * Don't allow arbitrary huge scans.
         */
        days =
            days === 10
                ? 10
                : 3;


        offset =
            Math.min(
                offset,
                MANDI_MAX_DAYS
            );


        const cacheKey =
            [
                state.toLowerCase(),
                district.toLowerCase(),
                offset,
                days
            ].join("|");


        const cached =
            mandiCache.get(cacheKey);


        if (
            cached &&
            Date.now() -
                cached.savedAt <
                MANDI_CACHE_MS
        ) {

            return res.json(
                cached.data
            );
        }


        if (
            mandiPending.has(cacheKey)
        ) {

            try {

                return res.json(
                    await mandiPending.get(
                        cacheKey
                    )
                );

            } catch {

                return res.status(500).json({
                    success: false,
                    message:
                        "Mandi data failed"
                });
            }
        }


        const job =
            (async () => {

                const fetched =
                    await fetchMandiDays(
                        state,
                        district,
                        offset,
                        days
                    );


                const markets =
                    processMandiCards(
                        fetched.records
                    );


                return {

                    success: true,

                    state,

                    district,

                    offset,

                    days,

                    nextOffset:
                        fetched.nextOffset,

                    hasMore:
                        fetched.hasMore,

                    markets
                };
            })();


        mandiPending.set(
            cacheKey,
            job
        );


        try {

            const result =
                await job;


            mandiCache.set(
                cacheKey,
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
                "Mandi endpoint:",
                error.response?.data ||
                error.message
            );


            return res.status(500).json({
                success: false,
                message:
                    "Mandi data failed"
            });

        } finally {

            mandiPending.delete(
                cacheKey
            );
        }
    }
);


// ==========================================================
// HISTORY ENDPOINT
//
// Exact:
// district + market + commodity + variety
//
// offset = history day offset
// scans up to 3 months
// returns max 5 date-price entries
// ==========================================================

app.get(
    "/api/mandi-history",
    async (req, res) => {

        cleanupMandiCache();


        const state =
            String(
                req.query.state || ""
            ).trim();

        const district =
            String(
                req.query.district || ""
            ).trim();

        const market =
            String(
                req.query.market || ""
            ).trim();

        const commodity =
            String(
                req.query.commodity || ""
            ).trim();

        const variety =
            String(
                req.query.variety || ""
            ).trim();


        let offset =
            Number(
                req.query.offset || 0
            );


        if (
            !state ||
            !district ||
            !market ||
            !commodity
        ) {

            return res.status(400).json({
                success: false,
                message:
                    "Missing history parameters"
            });
        }


        if (
            !Number.isFinite(offset) ||
            offset < 0
        ) {
            offset = 0;
        }


        const key =
            [
                state,
                district,
                market,
                commodity,
                variety,
                offset
            ]
                .join("|")
                .toLowerCase();


        const cached =
            mandiHistoryCache.get(
                key
            );


        if (
            cached &&
            Date.now() -
                cached.savedAt <
                MANDI_HISTORY_CACHE_MS
        ) {

            return res.json(
                cached.data
            );
        }


        // Maximum 5 matching dates per request
        const history = [];

        let cursor = offset;


        /*
         * Sequential here intentionally.
         *
         * Stop as soon as 5 history dates found.
         */
        while (
            cursor <
                MANDI_MAX_DAYS &&
            history.length < 5
        ) {

            const date =
                getMandiDateByOffset(
                    cursor
                );


            let records = [];


            try {

                records =
                    await fetchMandiOneDate(
                        state,
                        district,
                        date
                    );

            } catch (error) {

                console.warn(
                    `History ${date}:`,
                    error.response?.data?.error ||
                    error.message
                );
            }


            const match =
                records.find(
                    item =>
                        String(
                            item.Market || ""
                        )
                            .trim()
                            .toLowerCase() ===
                        market.toLowerCase() &&

                        String(
                            item.Commodity || ""
                        )
                            .trim()
                            .toLowerCase() ===
                        commodity.toLowerCase() &&

                        String(
                            item.Variety || ""
                        )
                            .trim()
                            .toLowerCase() ===
                        variety.toLowerCase()
                );


            if (match) {

                history.push({
                    date:
                        match.Arrival_Date,

                    price:
                        match.Modal_Price
                });
            }


            cursor++;


            if (
                cursor <
                    MANDI_MAX_DAYS &&
                history.length < 5
            ) {

                await mandiSleep(80);
            }
        }


        const result = {

            success: true,

            history,

            nextOffset:
                cursor,

            hasMore:
                cursor <
                MANDI_MAX_DAYS
        };


        mandiHistoryCache.set(
            key,
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
    }
);