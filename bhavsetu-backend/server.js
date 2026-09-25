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
// BHAVSETU MANDI
// EXACT LAST 3 MONTHS
// ALL MARKETS + ALL RECORDS + HISTORY
// ==========================================================

const mandiCache = new Map();
const mandiPending = new Map();

const MANDI_CACHE_MS =
    30 * 60 * 1000;

const MANDI_PAGE_SIZE =
    1000;

const MANDI_DATE_CONCURRENCY =
    4;

const MANDI_MAX_RETRIES =
    2;

const MANDI_RESOURCE_ID =
    "35985678-0d79-46b4-9ed6-6f13308a1d24";

const MANDI_API_KEY =
    process.env.AGMARKNET_API_KEY ||
    "579b464db66ec23bdd0000015a9fed0d92794b2374297ff3b6e5fdc7";


// ==========================================================
// HELPERS
// ==========================================================

function mandiSleep(ms) {

    return new Promise(
        resolve =>
            setTimeout(
                resolve,
                ms
            )
    );
}


function mandiDateString(date) {

    const dd =
        String(
            date.getDate()
        ).padStart(2, "0");

    const mm =
        String(
            date.getMonth() + 1
        ).padStart(2, "0");

    const yyyy =
        date.getFullYear();


    return `${dd}-${mm}-${yyyy}`;
}


function mandiDateTime(value) {

    if (!value) {
        return 0;
    }


    const parts =
        String(value)
            .trim()
            .split(/[\/-]/);


    if (parts.length !== 3) {
        return 0;
    }


    const day =
        Number(parts[0]);

    const month =
        Number(parts[1]);

    const year =
        Number(parts[2]);


    const date =
        new Date(
            year,
            month - 1,
            day
        );


    if (isNaN(date.getTime())) {
        return 0;
    }


    return date.getTime();
}


// ==========================================================
// EXACT LAST 3 CALENDAR MONTHS
//
// Example:
// Today: 25 Sep
// Start: 25 Jun
// ==========================================================

function getLast3MonthDates() {

    const today =
        new Date();


    today.setHours(
        0,
        0,
        0,
        0
    );


    const start =
        new Date(today);


    start.setMonth(
        start.getMonth() - 3
    );


    const dates = [];


    const cursor =
        new Date(today);


    while (
        cursor >= start
    ) {

        dates.push(
            mandiDateString(
                cursor
            )
        );


        cursor.setDate(
            cursor.getDate() - 1
        );
    }


    return {
        dates,

        from:
            mandiDateString(start),

        to:
            mandiDateString(today)
    };
}


// ==========================================================
// ONE API REQUEST WITH RETRY
// ==========================================================

async function mandiApiRequest(url) {

    let lastError = null;


    for (
        let attempt = 0;
        attempt <= MANDI_MAX_RETRIES;
        attempt++
    ) {

        try {

            const response =
                await axios.get(
                    url,
                    {
                        timeout:
                            25000
                    }
                );


            return response;


        } catch (error) {

            lastError =
                error;


            const isRateLimit =
                error.response?.status === 429 ||
                error.response?.data?.error ===
                    "Rate limit exceeded";


            const isTimeout =
                error.code ===
                    "ECONNABORTED" ||
                String(
                    error.message || ""
                )
                    .toLowerCase()
                    .includes(
                        "timeout"
                    );


            /*
             * Retry only temporary errors.
             */

            if (
                !isRateLimit &&
                !isTimeout
            ) {

                throw error;
            }


            if (
                attempt <
                MANDI_MAX_RETRIES
            ) {

                /*
                 * Rate limit => longer wait.
                 */

                const waitTime =
                    isRateLimit
                        ? 1500 *
                          (attempt + 1)
                        : 800 *
                          (attempt + 1);


                await mandiSleep(
                    waitTime
                );
            }
        }
    }


    throw lastError;
}


// ==========================================================
// FETCH ALL RECORDS OF ONE DATE
//
// 1000 = page size only.
// Total record limit nahi.
// ==========================================================

async function fetchMandiDateRecords(
    state,
    district,
    dateString
) {

    const allRecords = [];

    let offset = 0;


    while (true) {

        const url =
            `https://api.data.gov.in/resource/${MANDI_RESOURCE_ID}` +

            `?api-key=${encodeURIComponent(
                MANDI_API_KEY
            )}` +

            `&format=json` +

            `&limit=${MANDI_PAGE_SIZE}` +

            `&offset=${offset}` +

            `&filters[State]=${encodeURIComponent(
                state
            )}` +

            `&filters[District]=${encodeURIComponent(
                district
            )}` +

            `&filters[Arrival_Date]=${encodeURIComponent(
                dateString
            )}`;


        const response =
            await mandiApiRequest(
                url
            );


        const records =
            Array.isArray(
                response.data?.records
            )
                ? response.data.records
                : [];


        allRecords.push(
            ...records
        );


        /*
         * Last page.
         */

        if (
            records.length <
            MANDI_PAGE_SIZE
        ) {

            break;
        }


        offset +=
            records.length;


        /*
         * Tiny delay only if
         * pagination actually needed.
         */

        await mandiSleep(
            80
        );
    }


    return allRecords;
}


// ==========================================================
// FETCH COMPLETE LAST 3 MONTHS
// ==========================================================

async function fetch3MonthMandiData(
    state,
    district
) {

    const range =
        getLast3MonthDates();


    const dates =
        range.dates;


    const allRecords = [];


    /*
     * Few dates parallel for speed.
     * Not 90 requests simultaneously.
     */

    for (
        let i = 0;
        i < dates.length;
        i += MANDI_DATE_CONCURRENCY
    ) {

        const batch =
            dates.slice(
                i,
                i +
                MANDI_DATE_CONCURRENCY
            );


        const results =
            await Promise.all(
                batch.map(
                    async date => {

                        try {

                            return await fetchMandiDateRecords(
                                state,
                                district,
                                date
                            );


                        } catch (error) {

                            /*
                             * Error log karenge.
                             *
                             * Ek temporary failed date se
                             * poora endpoint crash nahi karenge.
                             */

                            console.warn(
                                `Mandi date ${date} failed:`,
                                error.response?.data ||
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

            allRecords.push(
                ...records
            );
        }


        /*
         * Government API ko continuously
         * hammer nahi karna.
         */

        if (
            i +
            MANDI_DATE_CONCURRENCY <
            dates.length
        ) {

            await mandiSleep(
                80
            );
        }
    }


    return {
        records:
            allRecords,

        from:
            range.from,

        to:
            range.to
    };
}


// ==========================================================
// BUILD FINAL DATA
//
// MARKET
//   |
//   +-- latest unique commodity+variety cards
//   |
//   +-- complete commodity+variety date/price history
// ==========================================================

function buildMandiData(
    allRecords
) {

    /*
     * Always newest first.
     */

    allRecords.sort(
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
        of allRecords
    ) {

        const marketName =
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
            !marketName ||
            !commodity
        ) {

            continue;
        }


        // ==================================================
        // MARKET
        // ==================================================

        if (
            !markets.has(
                marketName
            )
        ) {

            markets.set(
                marketName,
                {
                    market:
                        marketName,

                    latestDate:
                        item.Arrival_Date,

                    latest:
                        new Map(),

                    history:
                        new Map()
                }
            );
        }


        const market =
            markets.get(
                marketName
            );


        /*
         * Since records sorted newest first,
         * first item is market latest.
         */

        if (
            mandiDateTime(
                item.Arrival_Date
            ) >
            mandiDateTime(
                market.latestDate
            )
        ) {

            market.latestDate =
                item.Arrival_Date;
        }


        // ==================================================
        // EXACT CROP + VARIETY KEY
        // ==================================================

        const cropKey =
            `${commodity.toLowerCase()}|${variety.toLowerCase()}`;


        // ==================================================
        // MAIN CARD
        //
        // First = latest.
        // Same commodity+variety won't repeat.
        // ==================================================

        if (
            !market.latest.has(
                cropKey
            )
        ) {

            market.latest.set(
                cropKey,
                item
            );
        }


        // ==================================================
        // HISTORY
        // ==================================================

        if (
            !market.history.has(
                cropKey
            )
        ) {

            market.history.set(
                cropKey,
                new Map()
            );
        }


        const historyDates =
            market.history.get(
                cropKey
            );


        const dateKey =
            String(
                item.Arrival_Date || ""
            ).trim();


        /*
         * Only one price per date.
         *
         * Same market +
         * same commodity +
         * same variety +
         * same date
         * => duplicate nahi.
         */

        if (
            dateKey &&
            !historyDates.has(
                dateKey
            )
        ) {

            historyDates.set(
                dateKey,
                {
                    date:
                        dateKey,

                    price:
                        item.Modal_Price
                }
            );
        }
    }


    // ======================================================
    // CONVERT MAPS TO JSON
    // ======================================================

    const output = [];


    for (
        const market
        of markets.values()
    ) {

        const records =
            Array.from(
                market.latest.values()
            );


        /*
         * Main cards:
         * latest date first.
         */

        records.sort(
            (a, b) => {

                const dateDifference =
                    mandiDateTime(
                        b.Arrival_Date
                    ) -
                    mandiDateTime(
                        a.Arrival_Date
                    );


                if (
                    dateDifference !== 0
                ) {

                    return dateDifference;
                }


                const cropDifference =
                    String(
                        a.Commodity || ""
                    )
                        .localeCompare(
                            String(
                                b.Commodity || ""
                            ),
                            undefined,
                            {
                                sensitivity:
                                    "base"
                            }
                        );


                if (
                    cropDifference !== 0
                ) {

                    return cropDifference;
                }


                return String(
                    a.Variety || ""
                )
                    .localeCompare(
                        String(
                            b.Variety || ""
                        ),
                        undefined,
                        {
                            sensitivity:
                                "base"
                        }
                    );
            }
        );


        const history = {};


        for (
            const [key, dateMap]
            of market.history.entries()
        ) {

            const entries =
                Array.from(
                    dateMap.values()
                );


            /*
             * Newest -> oldest.
             */

            entries.sort(
                (a, b) =>
                    mandiDateTime(
                        b.date
                    ) -
                    mandiDateTime(
                        a.date
                    )
            );


            history[key] =
                entries;
        }


        output.push(
            {
                market:
                    market.market,

                latestDate:
                    market.latestDate,

                records,

                history
            }
        );
    }


    /*
     * Most recently updated markets first.
     * Same date => alphabetical.
     */

    output.sort(
        (a, b) => {

            const dateDifference =
                mandiDateTime(
                    b.latestDate
                ) -
                mandiDateTime(
                    a.latestDate
                );


            if (
                dateDifference !== 0
            ) {

                return dateDifference;
            }


            return a.market.localeCompare(
                b.market
            );
        }
    );


    return output;
}


// ==========================================================
// MAIN ENDPOINT
// ==========================================================

app.get(
    "/api/mandi-prices",
    async (req, res) => {

        const state =
            String(
                req.query.state || ""
            ).trim();


        const district =
            String(
                req.query.district || ""
            ).trim();


        if (
            !state ||
            !district
        ) {

            return res
                .status(400)
                .json(
                    {
                        success:
                            false,

                        message:
                            "State and district required"
                    }
                );
        }


        const cacheKey =
            `${state.toLowerCase()}|${district.toLowerCase()}`;


        // ==================================================
        // CACHE
        // ==================================================

        const cached =
            mandiCache.get(
                cacheKey
            );


        if (
            cached &&
            Date.now() -
                cached.savedAt <
                MANDI_CACHE_MS
        ) {

            console.log(
                `Mandi cache hit: ${district}, ${state}`
            );


            return res.json(
                cached.data
            );
        }


        // ==================================================
        // SAME REQUEST ALREADY RUNNING
        // ==================================================

        if (
            mandiPending.has(
                cacheKey
            )
        ) {

            console.log(
                `Waiting for mandi request: ${district}`
            );


            try {

                const result =
                    await mandiPending.get(
                        cacheKey
                    );


                return res.json(
                    result
                );


            } catch (error) {

                return res
                    .status(500)
                    .json(
                        {
                            success:
                                false,

                            message:
                                "Mandi data failed"
                        }
                    );
            }
        }


        // ==================================================
        // START FETCH JOB
        // ==================================================

        const job =
            (async () => {

                const fetched =
                    await fetch3MonthMandiData(
                        state,
                        district
                    );


                const markets =
                    buildMandiData(
                        fetched.records
                    );


                return {

                    success:
                        true,

                    state,

                    district,

                    period:
                        {
                            from:
                                fetched.from,

                            to:
                                fetched.to
                        },

                    totalMarkets:
                        markets.length,

                    totalRecords:
                        markets.reduce(
                            (
                                total,
                                market
                            ) =>
                                total +
                                market.records.length,
                            0
                        ),

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


            /*
             * Don't cache empty result.
             *
             * Temporary API failure shouldn't
             * make district appear empty for 30 min.
             */

            if (
                result.success &&
                result.markets.length >
                    0
            ) {

                mandiCache.set(
                    cacheKey,
                    {
                        savedAt:
                            Date.now(),

                        data:
                            result
                    }
                );
            }


            return res.json(
                result
            );


        } catch (error) {

            console.error(
                "Mandi endpoint error:",
                error.response?.data ||
                error.message ||
                error
            );


            return res
                .status(500)
                .json(
                    {
                        success:
                            false,

                        message:
                            "Mandi data failed"
                    }
                );


        } finally {

            mandiPending.delete(
                cacheKey
            );
        }
    }
);