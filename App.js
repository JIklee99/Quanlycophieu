/*
====================================================
ĐẦU TƯ CỔ TỨC
APP.JS
====================================================

TÍNH NĂNG:

- Nạp tiền
- Mua / bán cổ phiếu
- Giá vốn bình quân
- Phí giao dịch mặc định 0,25%
- Có thể chỉnh phí
- FIFO khi bán
- Theo dõi từng lô cổ phiếu
- Phí lưu ký 0,009đ/CP/ngày
- Phí lưu ký tính theo từng lô
- Cổ tức tiền mặt
- Cổ tức bằng cổ phiếu
- Cổ phiếu thưởng
- Tự tính CP đủ điều kiện ngày chốt quyền
- Ví cổ tức
- Tái đầu tư cổ tức
- Lãi tiền mặt 4%/năm
- Lịch sử giao dịch
- Lịch sử cổ tức
- Backup / Restore JSON
- Không cần server/database
====================================================
*/


/* ==================================================
   STORAGE
================================================== */

const STORAGE_KEY = "dautucotuc_v1";


const DEFAULT_DATA = {

    cash: 0,

    dividendWallet: 0,

    deposits: [],

    transactions: [],

    dividends: [],

    settings: {

        fee: 0.25,

        custody: 0.009,

        interest: 4,

        custodyEnabled: true

    }

};


let data = loadData();


/* ==================================================
   UTILITY
================================================== */

function clone(obj) {

    return JSON.parse(
        JSON.stringify(obj)
    );

}


function uid(prefix) {

    return (
        prefix +
        "_" +
        Date.now() +
        "_" +
        Math.random()
            .toString(36)
            .substring(2, 8)
    );

}


function today() {

    return new Date()
        .toISOString()
        .slice(0, 10);

}


function money(value) {

    return new Intl.NumberFormat(
        "vi-VN",
        {
            maximumFractionDigits: 2
        }
    ).format(
        Number(value) || 0
    ) + " đ";

}


function number(value, digits = 2) {

    return new Intl.NumberFormat(
        "vi-VN",
        {
            maximumFractionDigits: digits
        }
    ).format(
        Number(value) || 0
    );

}


function escapeHTML(value) {

    return String(value ?? "")
        .replace(/[&<>"']/g, function (char) {

            return {

                "&": "&amp;",
                "<": "&lt;",
                ">": "&gt;",
                '"': "&quot;",
                "'": "&#39;"

            }[char];

        });

}


function daysBetween(start, end) {

    const a =
        new Date(start + "T00:00:00");

    const b =
        new Date(end + "T00:00:00");

    return Math.max(
        0,
        Math.floor(
            (b - a) / 86400000
        ) + 1
    );

}


function mergeData(base, source) {

    for (const key in source) {

        if (
            source[key] &&
            typeof source[key] === "object" &&
            !Array.isArray(source[key])
        ) {

            base[key] =
                mergeData(
                    base[key] || {},
                    source[key]
                );

        } else {

            base[key] = source[key];

        }

    }

    return base;

}


/* ==================================================
   LOAD / SAVE
================================================== */

function loadData() {

    try {

        const saved =
            localStorage.getItem(
                STORAGE_KEY
            );

        if (!saved) {

            return clone(DEFAULT_DATA);

        }

        return mergeData(
            clone(DEFAULT_DATA),
            JSON.parse(saved)
        );

    } catch (error) {

        console.error(error);

        return clone(DEFAULT_DATA);

    }

}


function saveData() {

    localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify(data)
    );

    renderAll();

}


/* ==================================================
   TOAST
================================================== */

function toast(message) {

    const element =
        document.getElementById(
            "toast"
        );

    element.textContent =
        message;

    element.classList.add(
        "show"
    );

    clearTimeout(
        window.__toastTimer
    );

    window.__toastTimer =
        setTimeout(() => {

            element.classList.remove(
                "show"
            );

        }, 2500);

}


/* ==================================================
   FEE
================================================== */

function calculateTradingFee(
    amount
) {

    const percent =
        Number(
            data.settings.fee
        ) || 0;

    return amount *
        percent /
        100;

}


/* ==================================================
   DEPOSIT
================================================== */

function addDeposit(form) {

    const amount =
        Number(
            form.amount.value
        );

    if (amount <= 0) {

        throw new Error(
            "Số tiền nạp phải lớn hơn 0."
        );

    }


    data.deposits.push({

        id: uid("deposit"),

        date: form.date.value,

        amount,

        note:
            form.note.value.trim()

    });


    saveData();


    form.reset();

    form.date.value =
        today();


    toast(
        "Đã nạp tiền."
    );

}


/* ==================================================
   SYMBOL LIST
================================================== */

function getSymbols() {

    const symbols =
        new Set();


    data.transactions.forEach(
        transaction => {

            if (
                transaction.symbol
            ) {

                symbols.add(
                    transaction.symbol
                );

            }

        }
    );


    data.dividends.forEach(
        dividend => {

            if (
                dividend.symbol
            ) {

                symbols.add(
                    dividend.symbol
                );

            }

        }
    );


    return Array.from(
        symbols
    ).sort();

}


/* ==================================================
   REPLAY FIFO
==================================================

   Đây là phần rất quan trọng.

   Mỗi lần cần biết đang giữ bao nhiêu
   cổ phiếu, hệ thống dựng lại toàn bộ
   lịch sử giao dịch theo FIFO.

================================================== */

function replaySymbol(symbol) {

    const events = [];


    data.transactions
        .filter(
            t => t.symbol === symbol
        )
        .forEach(
            t => {

                events.push({
                    ...t,
                    eventType:
                        t.type
                });

            }
        );


    /*
       Cổ tức cổ phiếu / cổ phiếu thưởng
       tạo ra một lô mới.
    */

    data.dividends
        .filter(
            d =>
                d.symbol === symbol &&
                d.type !== "cash" &&
                Number(d.receivedQty) > 0
        )
        .forEach(
            d => {

                events.push({

                    id: d.id,

                    date: d.payDate,

                    symbol,

                    eventType:
                        "stockDividend",

                    qty:
                        Number(
                            d.receivedQty
                        ),

                    price: 0

                });

            }
        );


    /*
       Sắp xếp theo ngày.

       Nếu cùng ngày thì
       cổ tức CP được cộng trước
       bán ra.
    */

    events.sort(
        (a, b) => {

            const dateCompare =
                a.date.localeCompare(
                    b.date
                );

            if (
                dateCompare !== 0
            ) {

                return dateCompare;

            }

            const priority = {

                stockDividend: 0,

                buy: 1,

                sell: 2

            };

            return (
                (priority[a.eventType] ?? 1) -
                (priority[b.eventType] ?? 1)
            );

        }
    );


    const lots = [];


    for (
        const event of events
    ) {


        /*
           MUA
        */

        if (
            event.eventType === "buy"
        ) {

            lots.push({

                id: event.id,

                date: event.date,

                qty:
                    Number(event.qty) || 0,

                price:
                    Number(event.price) || 0,

                source: "buy"

            });

        }


        /*
           CỔ TỨC CP /
           CỔ PHIẾU THƯỞNG
        */

        else if (
            event.eventType ===
            "stockDividend"
        ) {

            lots.push({

                id:
                    uid("dividend_lot"),

                date:
                    event.date,

                qty:
                    Number(event.qty) || 0,

                price: 0,

                source:
                    "dividend"

            });

        }


        /*
           BÁN FIFO
        */

        else if (
            event.eventType === "sell"
        ) {

            let remaining =
                Number(event.qty) || 0;


            for (
                const lot of lots
            ) {

                if (
                    remaining <= 0
                ) {

                    break;

                }


                const take =
                    Math.min(
                        lot.qty,
                        remaining
                    );


                lot.qty -= take;

                remaining -= take;

            }


            if (
                remaining > 0.000001
            ) {

                throw new Error(
                    `Không đủ ${symbol} để bán ${number(event.qty, 0)} CP.`
                );

            }

        }

    }


    return lots.filter(
        lot =>
            lot.qty >
            0.000001
    );

}


/* ==================================================
   CURRENT HOLDINGS
================================================== */

function getHoldingLots(
    symbol
) {

    return replaySymbol(
        symbol
    );

}


function getHoldingQuantity(
    symbol
) {

    return getHoldingLots(
        symbol
    ).reduce(
        (total, lot) =>
            total + lot.qty,
        0
    );

}


/* ==================================================
   HOLDING AT RECORD DATE
==================================================

   Dùng để xác định số CP đủ điều kiện
   nhận cổ tức.

================================================== */

function getHoldingAtDate(
    symbol,
    date
) {

    const events = [];


    data.transactions
        .filter(
            t =>
                t.symbol === symbol &&
                t.date <= date
        )
        .forEach(
            t => events.push({
                ...t,
                eventType:
                    t.type
            })
        );


    data.dividends
        .filter(
            d =>
                d.symbol === symbol &&
                d.type !== "cash" &&
                d.payDate <= date
        )
        .forEach(
            d => events.push({

                date: d.payDate,

                eventType:
                    "stockDividend",

                qty:
                    Number(
                        d.receivedQty
                    ) || 0

            })
        );


    events.sort(
        (a, b) =>
            a.date.localeCompare(
                b.date
            )
    );


    const lots = [];


    for (
        const event of events
    ) {

        if (
            event.eventType === "buy"
        ) {

            lots.push({

                qty:
                    Number(
                        event.qty
                    ) || 0

            });

        }


        else if (
            event.eventType ===
            "stockDividend"
        ) {

            lots.push({

                qty:
                    Number(
                        event.qty
                    ) || 0

            });

        }


        else if (
            event.eventType === "sell"
        ) {

            let remaining =
                Number(
                    event.qty
                ) || 0;


            for (
                const lot of lots
            ) {

                if (
                    remaining <= 0
                ) {

                    break;

                }


                const take =
                    Math.min(
                        lot.qty,
                        remaining
                    );


                lot.qty -= take;

                remaining -= take;

            }

        }

    }


    return lots.reduce(
        (total, lot) =>
            total + lot.qty,
        0
    );

}


/* ==================================================
   CASH
================================================== */

function calculateCash() {

    let cash = 0;


    /*
       NẠP TIỀN
    */

    data.deposits.forEach(
        deposit => {

            cash +=
                Number(
                    deposit.amount
                ) || 0;

        }
    );


    /*
       GIAO DỊCH
    */

    data.transactions.forEach(
        transaction => {

            if (
                transaction.type ===
                "buy" &&
                transaction.source ===
                "cash"
            ) {

                cash -=
                    Number(
                        transaction.total
                    ) || 0;

            }


            if (
                transaction.type ===
                "sell"
            ) {

                cash +=
                    Number(
                        transaction.net
                    ) || 0;

            }

        }
    );


    return cash;

}


/* ==================================================
   DIVIDEND WALLET
================================================== */

function calculateDividendWallet() {

    let wallet = 0;


    /*
       CỔ TỨC TIỀN
    */

    data.dividends
        .filter(
            d =>
                d.type === "cash"
        )
        .forEach(
            d => {

                wallet +=
                    Number(
                        d.cashTotal
                    ) || 0;

            }
        );


    /*
       MUA TÁI ĐẦU TƯ
    */

    data.transactions
        .filter(
            t =>
                t.type === "buy" &&
                t.source ===
                "dividend"
        )
        .forEach(
            t => {

                wallet -=
                    Number(
                        t.total
                    ) || 0;

            }
        );


    return wallet;

}


/* ==================================================
   CASH INTEREST
==================================================

   Tính theo số ngày thực tế.

================================================== */

function calculateCashInterest() {

    const events = [];


    data.deposits.forEach(
        deposit => {

            events.push({

                date:
                    deposit.date,

                delta:
                    Number(
                        deposit.amount
                    ) || 0

            });

        }
    );


    data.transactions.forEach(
        transaction => {

            if (
                transaction.type ===
                "buy" &&
                transaction.source ===
                "cash"
            ) {

                events.push({

                    date:
                        transaction.date,

                    delta:
                        -(
                            Number(
                                transaction.total
                            ) || 0
                        )

                });

            }


            if (
                transaction.type ===
                "sell"
            ) {

                events.push({

                    date:
                        transaction.date,

                    delta:
                        Number(
                            transaction.net
                        ) || 0

                });

            }

        }
    );


    events.sort(
        (a, b) =>
            a.date.localeCompare(
                b.date
            )
    );


    if (
        events.length === 0
    ) {

        return 0;

    }


    let balance = 0;

    let interest = 0;

    let currentDate =
        events[0].date;


    for (
        let i = 0;
        i < events.length;
        i++
    ) {

        const event =
            events[i];


        if (
            event.date >
            currentDate
        ) {

            const days =
                daysBetween(
                    currentDate,
                    event.date
                ) - 1;


            if (
                days > 0
            ) {

                interest +=
                    balance *
                    (
                        Number(
                            data.settings
                                .interest
                        ) || 0
                    ) /
                    100 *
                    days /
                    365;

            }

        }


        balance +=
            event.delta;


        currentDate =
            event.date;

    }


    /*
       Từ ngày cuối cùng
       đến hôm nay.
    */

    const finalDays =
        daysBetween(
            currentDate,
            today()
        );


    if (
        finalDays > 0
    ) {

        interest +=
            balance *
            (
                Number(
                    data.settings
                        .interest
                ) || 0
            ) /
            100 *
            finalDays /
            365;

    }


    return Math.max(
        0,
        interest
    );

}


/* ==================================================
   CUSTODY FEE
==================================================

   PHÍ LƯU KÝ:

   0,009đ / CP / ngày

   Tính theo từng lô.

   Ví dụ:

   01/08 mua 1.000 ADP
   10/08 mua 500 ADP

   Hai lô có số ngày khác nhau.

   Khi bán FIFO:
   lô cũ bị trừ trước.

================================================== */

function calculateCustodyFee() {

    if (
        !data.settings
            .custodyEnabled
    ) {

        return 0;

    }


    const endDate =
        today();


    let total = 0;


    for (
        const symbol of getSymbols()
    ) {

        const lots =
            getHoldingLots(
                symbol
            );


        for (
            const lot of lots
        ) {

            const days =
                daysBetween(
                    lot.date,
                    endDate
                );


            total +=
                lot.qty *
                (
                    Number(
                        data.settings
                            .custody
                    ) || 0
                ) *
                days;

        }

    }


    return total;

}


/* ==================================================
   PORTFOLIO
================================================== */

function getPortfolio() {

    const result = [];


    for (
        const symbol of getSymbols()
    ) {

        const lots =
            getHoldingLots(
                symbol
            );


        const quantity =
            lots.reduce(
                (sum, lot) =>
                    sum + lot.qty,
                0
            );


        /*
           Giá vốn còn lại.

           Cổ tức CP / thưởng
           có giá vốn = 0.
        */

        const cost =
            lots.reduce(
                (sum, lot) =>
                    sum +
                    lot.qty *
                    lot.price,
                0
            );


        const averageCost =
            quantity > 0
                ? cost / quantity
                : 0;


        const transactionFees =
            data.transactions
                .filter(
                    t =>
                        t.symbol ===
                        symbol
                )
                .reduce(
                    (sum, t) =>
                        sum +
                        (
                            Number(
                                t.fee
                            ) || 0
                        ),
                    0
                );


        const cashDividend =
            data.dividends
                .filter(
                    d =>
                        d.symbol ===
                            symbol &&
                        d.type ===
                            "cash"
                )
                .reduce(
                    (sum, d) =>
                        sum +
                        (
                            Number(
                                d.cashTotal
                            ) || 0
                        ),
                    0
                );


        const stockDividend =
            data.dividends
                .filter(
                    d =>
                        d.symbol ===
                            symbol &&
                        d.type !==
                            "cash"
                )
                .reduce(
                    (sum, d) =>
                        sum +
                        (
                            Number(
                                d.receivedQty
                            ) || 0
                        ),
                    0
                );


        result.push({

            symbol,

            lots,

            quantity,

            cost,

            averageCost,

            transactionFees,

            cashDividend,

            stockDividend

        });

    }


    return result.filter(
        item =>
            item.quantity > 0 ||
            item.cashDividend > 0 ||
            item.stockDividend > 0
    );

}


/* ==================================================
   ADD TRADE
================================================== */

function addTrade(form) {

    const type =
        form.type.value;


    const date =
        form.date.value;


    const symbol =
        form.symbol.value
            .trim()
            .toUpperCase();


    const quantity =
        Number(
            form.qty.value
        );


    const price =
        Number(
            form.price.value
        );


    const source =
        form.source.value;


    if (
        !date ||
        !symbol ||
        quantity <= 0 ||
        price < 0
    ) {

        throw new Error(
            "Kiểm tra lại thông tin giao dịch."
        );

    }


    const value =
        quantity *
        price;


    const fee =
        calculateTradingFee(
            value
        );


    const total =
        value +
        fee;


    /*
       MUA
    */

    if (
        type === "buy"
    ) {

        if (
            source === "cash"
        ) {

            const cash =
                calculateCash();


            if (
                cash <
                total -
                0.000001
            ) {

                throw new Error(
                    "Không đủ tiền mặt."
                );

            }

        }


        if (
            source ===
            "dividend"
        ) {

            const wallet =
                calculateDividendWallet();


            if (
                wallet <
                total -
                0.000001
            ) {

                throw new Error(
                    "Không đủ tiền trong ví cổ tức."
                );

            }

        }


        data.transactions.push({

            id:
                uid("tx"),

            type:
                "buy",

            date,

            symbol,

            qty:
                quantity,

            price,

            fee,

            total,

            net:
                -total,

            source,

            note:
                form.note.value
                    .trim()

        });

    }


    /*
       BÁN
    */

    else {

        const holding =
            getHoldingQuantity(
                symbol
            );


        if (
            holding <
            quantity -
            0.000001
        ) {

            throw new Error(
                `Không đủ ${symbol} để bán.`
            );

        }


        const net =
            value -
            fee;


        /*
           Tính giá vốn FIFO
           tại thời điểm bán.

           Dùng để lưu lại
           thông tin giao dịch.
        */

        const lots =
            getHoldingLots(
                symbol
            );


        let remaining =
            quantity;


        let costBasis =
            0;


        for (
            const lot of lots
        ) {

            if (
                remaining <= 0
            ) {

                break;

            }


            const take =
                Math.min(
                    lot.qty,
                    remaining
                );


            costBasis +=
                take *
                lot.price;


            remaining -=
                take;

        }


        data.transactions.push({

            id:
                uid("tx"),

            type:
                "sell",

            date,

            symbol,

            qty:
                quantity,

            price,

            fee,

            total:
                value,

            net,

            source:
                "cash",

            costBasis,

            realized:
                net -
                costBasis,

            note:
                form.note.value
                    .trim()

        });

    }


    /*
       Kiểm tra toàn bộ FIFO
       sau khi thêm giao dịch.

       Nếu lỗi thì rollback.
    */

    try {

        getHoldingLots(
            symbol
        );

    } catch (error) {

        data.transactions.pop();

        throw error;

    }


    saveData();


    resetTradeForm();


    toast(
        type === "buy"
            ? "Đã mua cổ phiếu."
            : "Đã bán cổ phiếu."
    );

}


/* ==================================================
   ADD DIVIDEND
================================================== */

function addDividend(form) {

    const symbol =
        form.symbol.value
            .trim()
            .toUpperCase();


    const type =
        form.type.value;


    const recordDate =
        form.recordDate.value;


    const payDate =
        form.payDate.value;


    if (
        !symbol ||
        !recordDate ||
        !payDate
    ) {

        throw new Error(
            "Thiếu thông tin cổ tức."
        );

    }


    /*
       Tự tính số CP đủ điều kiện.
    */

    const eligible =
        Math.floor(
            getHoldingAtDate(
                symbol,
                recordDate
            ) +
            0.000001
        );


    if (
        eligible <= 0
    ) {

        throw new Error(
            `Không có ${symbol} đủ điều kiện nhận cổ tức tại ngày chốt quyền.`
        );

    }


    const dividend = {

        id:
            uid("dividend"),

        symbol,

        type,

        recordDate,

        payDate,

        eligible,

        note:
            form.note.value
                .trim()

    };


    /*
       CỔ TỨC TIỀN
    */

    if (
        type === "cash"
    ) {

        const cashPerShare =
            Number(
                form.cashPerShare.value
            );


        if (
            cashPerShare <= 0
        ) {

            throw new Error(
                "Cổ tức tiền / CP phải lớn hơn 0."
            );

        }


        dividend.cashPerShare =
            cashPerShare;


        dividend.cashTotal =
            eligible *
            cashPerShare;

    }


    /*
       CỔ TỨC BẰNG CỔ PHIẾU
       hoặc
       CỔ PHIẾU THƯỞNG
    */

    else {

        const base =
            Number(
                form.ratioBase.value
            );


        const newShares =
            Number(
                form.ratioNew.value
            );


        if (
            base <= 0 ||
            newShares < 0
        ) {

            throw new Error(
                "Tỷ lệ cổ phiếu không hợp lệ."
            );

        }


        /*
           Ví dụ:

           10 : 1

           10 CP cũ
           nhận 1 CP mới.
        */

        dividend.ratioBase =
            base;


        dividend.ratioNew =
            newShares;


        dividend.receivedQty =
            Math.floor(
                eligible *
                newShares /
                base
            );

    }


    data.dividends.push(
        dividend
    );


    saveData();


    form.reset();


    form.recordDate.value =
        today();


    form.payDate.value =
        today();


    form.ratioBase.value =
        10;


    form.ratioNew.value =
        1;


    form.cashPerShare.value =
        0;


    toast(
        "Đã lưu quyền cổ tức."
    );

}


/* ==================================================
   DELETE TRANSACTION
================================================== */

function deleteTransaction(
    id
) {

    const backup =
        clone(data);


    const index =
        data.transactions.findIndex(
            t =>
                t.id === id
        );


    if (
        index === -1
    ) {

        return;

    }


    data.transactions.splice(
        index,
        1
    );


    try {

        /*
           Kiểm tra toàn bộ
           danh mục sau khi xóa.
        */

        for (
            const symbol of getSymbols()
        ) {

            getHoldingLots(
                symbol
            );

        }


        saveData();

        toast(
            "Đã xóa giao dịch."
        );

    } catch (error) {

        data =
            backup;

        saveData();

        alert(
            error.message
        );

    }

}


/* ==================================================
   DELETE DIVIDEND
================================================== */

function deleteDividend(
    id
) {

    if (
        !confirm(
            "Xóa quyền cổ tức này?"
        )
    ) {

        return;

    }


    data.dividends =
        data.dividends.filter(
            d =>
                d.id !== id
        );


    saveData();


    toast(
        "Đã xóa cổ tức."
    );

}


/* ==================================================
   RENDER DASHBOARD
================================================== */

function renderDashboard() {

    const portfolio =
        getPortfolio();


    const deposits =
        data.deposits.reduce(
            (sum, d) =>
                sum +
                (
                    Number(
                        d.amount
                    ) || 0
                ),
            0
        );


    const cash =
        calculateCash();


    const dividendWallet =
        calculateDividendWallet();


    const available =
        cash +
        dividendWallet;


    const invested =
        portfolio.reduce(
            (sum, item) =>
                sum +
                item.cost,
            0
        );


    const cashDividend =
        data.dividends
            .filter(
                d =>
                    d.type ===
                    "cash"
            )
            .reduce(
                (sum, d) =>
                    sum +
                    (
                        Number(
                            d.cashTotal
                        ) || 0
                    ),
                0
            );


    const fees =
        data.transactions.reduce(
            (sum, t) =>
                sum +
                (
                    Number(
                        t.fee
                    ) || 0
                ),
            0
        );


    const interest =
        calculateCashInterest();


    const custody =
        calculateCustodyFee();


    const dashboard =
        document.getElementById(
            "dashboard"
        );


    const cards = [

        [
            "Tổng tiền nạp",
            money(deposits)
        ],

        [
            "Tiền mặt",
            money(cash)
        ],

        [
            "Ví cổ tức",
            money(dividendWallet)
        ],

        [
            "Tiền khả dụng",
            money(available)
        ],

        [
            "Vốn cổ phiếu",
            money(invested)
        ],

        [
            "Cổ tức tiền mặt",
            money(cashDividend)
        ],

        [
            "Lãi tiền mặt",
            money(interest)
        ],

        [
            "Phí lưu ký",
            money(custody)
        ]

    ];


    dashboard.innerHTML =
        cards.map(
            card => `

                <div class="stat">

                    <div class="label">
                        ${card[0]}
                    </div>

                    <div class="value">
                        ${card[1]}
                    </div>

                </div>

            `
        ).join("");

}


/* ==================================================
   RENDER PORTFOLIO
================================================== */

function renderPortfolio() {

    const portfolio =
        getPortfolio();


    const element =
        document.getElementById(
            "portfolio"
        );


    if (
        portfolio.length === 0
    ) {

        element.innerHTML = `

            <div class="card">

                <div class="hint">

                    Chưa có cổ phiếu.

                    Hãy thêm giao dịch mua
                    đầu tiên.

                </div>

            </div>

        `;

        return;

    }


    element.innerHTML =
        portfolio.map(
            item => `

                <div class="card stock-card">

                    <h3>
                        ${escapeHTML(
                            item.symbol
                        )}
                    </h3>


                    <div class="stock-meta">


                        <div class="kv">

                            <span>
                                Số CP
                            </span>

                            <b>
                                ${number(
                                    item.quantity,
                                    0
                                )}
                            </b>

                        </div>


                        <div class="kv">

                            <span>
                                Giá vốn BQ
                            </span>

                            <b>
                                ${money(
                                    item.averageCost
                                )}
                            </b>

                        </div>


                        <div class="kv">

                            <span>
                                Giá vốn còn lại
                            </span>

                            <b>
                                ${money(
                                    item.cost
                                )}
                            </b>

                        </div>


                        <div class="kv">

                            <span>
                                Số lô
                            </span>

                            <b>
                                ${item.lots.length}
                            </b>

                        </div>


                        <div class="kv">

                            <span>
                                Cổ tức tiền
                            </span>

                            <b>
                                ${money(
                                    item.cashDividend
                                )}
                            </b>

                        </div>


                        <div class="kv">

                            <span>
                                CP từ quyền
                            </span>

                            <b>
                                ${number(
                                    item.stockDividend,
                                    0
                                )}
                            </b>

                        </div>


                    </div>

                </div>

            `
        ).join("");

}


/* ==================================================
   TRANSACTION TABLE
================================================== */

function transactionTable(
    transactions
) {

    if (
        transactions.length === 0
    ) {

        return `

            <div class="card">

                <div class="hint">
                    Chưa có dữ liệu.
                </div>

            </div>

        `;

    }


    const sorted =
        transactions
            .slice()
            .sort(
                (a, b) =>
                    b.date.localeCompare(
                        a.date
                    )
            );


    return `

        <table>

            <thead>

                <tr>

                    <th>Ngày</th>

                    <th>Loại</th>

                    <th>Mã</th>

                    <th>SL</th>

                    <th>Giá</th>

                    <th>Phí</th>

                    <th>Tổng</th>

                    <th>Nguồn</th>

                    <th></th>

                </tr>

            </thead>


            <tbody>

                ${sorted.map(
                    transaction => `

                        <tr>

                            <td>
                                ${escapeHTML(
                                    transaction.date
                                )}
                            </td>


                            <td class="${
                                transaction.type ===
                                "sell"
                                    ? "red"
                                    : "green"
                            }">

                                ${
                                    transaction.type ===
                                    "buy"
                                        ? "MUA"
                                        : "BÁN"
                                }

                            </td>


                            <td>
                                ${escapeHTML(
                                    transaction.symbol
                                )}
                            </td>


                            <td>
                                ${number(
                                    transaction.qty,
                                    0
                                )}
                            </td>


                            <td>
                                ${money(
                                    transaction.price
                                )}
                            </td>


                            <td>
                                ${money(
                                    transaction.fee
                                )}
                            </td>


                            <td>
                                ${money(
                                    transaction.total
                                )}
                            </td>


                            <td>

                                ${
                                    transaction.type ===
                                    "buy"

                                        ? (
                                            transaction.source ===
                                            "dividend"

                                                ? "Ví cổ tức"

                                                : "Tiền mặt"
                                          )

                                        : "—"
                                }

                            </td>


                            <td>

                                <button
                                    class="action"
                                    onclick="
                                        deleteTransaction(
                                            '${transaction.id}'
                                        )
                                    ">

                                    Xóa

                                </button>

                            </td>

                        </tr>

                    `
                ).join("")}

            </tbody>

        </table>

    `;

}


/* ==================================================
   RENDER TRANSACTIONS
================================================== */

function renderTransactions() {

    const table =
        transactionTable(
            data.transactions
        );


    document.getElementById(
        "transactions"
    ).innerHTML =
        table;


    document.getElementById(
        "recent"
    ).innerHTML =
        transactionTable(
            data.transactions
                .slice(0, 8)
        );

}


/* ==================================================
   RENDER DIVIDENDS
================================================== */

function renderDividends() {

    const element =
        document.getElementById(
            "dividends"
        );


    const dividends =
        data.dividends
            .slice()
            .sort(
                (a, b) =>
                    b.payDate.localeCompare(
                        a.payDate
                    )
            );


    if (
        dividends.length === 0
    ) {

        element.innerHTML = `

            <div class="card">

                <div class="hint">

                    Chưa có lịch sử cổ tức.

                </div>

            </div>

        `;

        return;

    }


    element.innerHTML = `

        <table>

            <thead>

                <tr>

                    <th>
                        Ngày chốt
                    </th>

                    <th>
                        Ngày nhận
                    </th>

                    <th>
                        Mã
                    </th>

                    <th>
                        Loại
                    </th>

                    <th>
                        CP đủ ĐK
                    </th>

                    <th>
                        Kết quả
                    </th>

                    <th></th>

                </tr>

            </thead>


            <tbody>

                ${dividends.map(
                    dividend => {

                        let result = "";


                        if (
                            dividend.type ===
                            "cash"
                        ) {

                            result =
                                money(
                                    dividend.cashTotal
                                );

                        } else {

                            result =
                                `${number(
                                    dividend.receivedQty,
                                    0
                                )} CP
                                (${dividend.ratioBase}:${dividend.ratioNew})`;

                        }


                        return `

                            <tr>

                                <td>
                                    ${dividend.recordDate}
                                </td>

                                <td>
                                    ${dividend.payDate}
                                </td>

                                <td>
                                    ${escapeHTML(
                                        dividend.symbol
                                    )}
                                </td>

                                <td>

                                    ${
                                        dividend.type ===
                                        "cash"

                                            ? "Tiền mặt"

                                            : dividend.type ===
                                              "stock"

                                                ? "Cổ tức CP"

                                                : "CP thưởng"
                                    }

                                </td>


                                <td>
                                    ${number(
                                        dividend.eligible,
                                        0
                                    )}
                                </td>


                                <td>
                                    ${result}
                                </td>


                                <td>

                                    <button
                                        class="action"
                                        onclick="
                                            deleteDividend(
                                                '${dividend.id}'
                                            )
                                        ">

                                        Xóa

                                    </button>

                                </td>

                            </tr>

                        `;

                    }
                ).join("")}

            </tbody>

        </table>

    `;

}


/* ==================================================
   SETTINGS
================================================== */

function renderSettings() {

    const form =
        document.getElementById(
            "settingsForm"
        );


    form.fee.value =
        data.settings.fee;


    form.custody.value =
        data.settings.custody;


    form.interest.value =
        data.settings.interest;


    form.custodyEnabled.checked =
        !!data.settings
            .custodyEnabled;

}


/* ==================================================
   RENDER ALL
================================================== */

function renderAll() {

    renderDashboard();

    renderPortfolio();

    renderTransactions();

    renderDividends();

    renderSettings();

}


/* ==================================================
   RESET TRADE FORM
================================================== */

function resetTradeForm() {

    const form =
        document.getElementById(
            "tradeForm"
        );


    form.reset();


    form.date.value =
        today();


    form.type.value =
        "buy";


    form.source.value =
        "cash";

}


/* ==================================================
   OPEN TRADE
================================================== */

function openTrade(
    type
) {

    document
        .querySelector(
            '[data-tab="trade"]'
        )
        .click();


    document
        .getElementById(
            "tradeForm"
        )
        .type.value =
        type;

}


/* ==================================================
   BACKUP
================================================== */

function backupJSON() {

    const backup = {

        version: 1,

        exportedAt:
            new Date()
                .toISOString(),

        data

    };


    const blob =
        new Blob(
            [
                JSON.stringify(
                    backup,
                    null,
                    2
                )
            ],
            {
                type:
                    "application/json"
            }
        );


    const url =
        URL.createObjectURL(
            blob
        );


    const link =
        document.createElement(
            "a"
        );


    link.href =
        url;


    link.download =
        `dautucotuc_backup_${today()}.json`;


    link.click();


    URL.revokeObjectURL(
        url
    );


    toast(
        "Đã xuất backup JSON."
    );

}


/* ==================================================
   RESTORE
================================================== */

async function restoreJSON(
    file
) {

    try {

        const text =
            await file.text();


        const backup =
            JSON.parse(
                text
            );


        let restored;


        /*
           Hỗ trợ cả:

           {
              version: 1,
              data: {...}
           }

           và dữ liệu cũ trực tiếp.
        */

        if (
            backup.data
        ) {

            restored =
                backup.data;

        } else {

            restored =
                backup;

        }


        if (
            !restored ||
            !Array.isArray(
                restored.transactions
            ) ||
            !Array.isArray(
                restored.dividends
            )
        ) {

            throw new Error(
                "File backup không hợp lệ."
            );

        }


        data =
            mergeData(
                clone(
                    DEFAULT_DATA
                ),
                restored
            );


        /*
           Kiểm tra FIFO sau restore.
        */

        for (
            const symbol of getSymbols()
        ) {

            getHoldingLots(
                symbol
            );

        }


        saveData();


        toast(
            "Đã khôi phục backup."
        );

    } catch (error) {

        alert(
            "Không thể khôi phục: " +
            error.message
        );

    }

}


/* ==================================================
   RESET ALL
================================================== */

function resetAll() {

    if (
        !confirm(
            "Xóa TOÀN BỘ dữ liệu?\n\nHãy backup trước nếu cần."
        )
    ) {

        return;

    }


    data =
        clone(
            DEFAULT_DATA
        );


    saveData();


    toast(
        "Đã xóa toàn bộ dữ liệu."
    );

}


/* ==================================================
   TAB
================================================== */

document
    .querySelectorAll(
        ".tab"
    )
    .forEach(
        button => {

            button.addEventListener(
                "click",
                () => {

                    document
                        .querySelectorAll(
                            ".tab"
                        )
                        .forEach(
                            item =>
                                item.classList
                                    .remove(
                                        "active"
                                    )
                        );


                    document
                        .querySelectorAll(
                            ".tab-panel"
                        )
                        .forEach(
                            panel =>
                                panel.classList
                                    .remove(
                                        "active"
                                    )
                        );


                    button.classList.add(
                        "active"
                    );


                    document
                        .getElementById(
                            button.dataset.tab
                        )
                        .classList.add(
                            "active"
                        );

                }
            );

        }
    );


/* ==================================================
   DEPOSIT FORM
================================================== */

document
    .getElementById(
        "depositForm"
    )
    .addEventListener(
        "submit",
        event => {

            event.preventDefault();


            try {

                addDeposit(
                    event.target
                );

            } catch (error) {

                alert(
                    error.message
                );

            }

        }
    );


/* ==================================================
   TRADE FORM
================================================== */

document
    .getElementById(
        "tradeForm"
    )
    .addEventListener(
        "submit",
        event => {

            event.preventDefault();


            try {

                addTrade(
                    event.target
                );

            } catch (error) {

                alert(
                    error.message
                );

            }

        }
    );


/* ==================================================
   DIVIDEND FORM
================================================== */

document
    .getElementById(
        "dividendForm"
    )
    .addEventListener(
        "submit",
        event => {

            event.preventDefault();


            try {

                addDividend(
                    event.target
                );

            } catch (error) {

                alert(
                    error.message
                );

            }

        }
    );


/* ==================================================
   SETTINGS FORM
================================================== */

document
    .getElementById(
        "settingsForm"
    )
    .addEventListener(
        "submit",
        event => {

            event.preventDefault();


            const form =
                event.target;


            data.settings.fee =
                Number(
                    form.fee.value
                ) || 0;


            data.settings.custody =
                Number(
                    form.custody.value
                ) || 0;


            data.settings.interest =
                Number(
                    form.interest.value
                ) || 0;


            data.settings
                .custodyEnabled =
                form
                    .custodyEnabled
                    .checked;


            saveData();


            toast(
                "Đã lưu cài đặt."
            );

        }
    );


/* ==================================================
   RESTORE INPUT
================================================== */

document
    .getElementById(
        "restoreInput"
    )
    .addEventListener(
        "change",
        async event => {

            const file =
                event.target.files[0];


            if (!file) {

                return;

            }


            await restoreJSON(
                file
            );


            event.target.value =
                "";

        }
    );


/* ==================================================
   DEFAULT DATES
================================================== */

document
    .querySelectorAll(
        '#depositForm [name="date"],' +
        '#tradeForm [name="date"],' +
        '#dividendForm [name="recordDate"],' +
        '#dividendForm [name="payDate"]'
    )
    .forEach(
        input => {

            input.value =
                today();

        }
    );


/* ==================================================
   START
================================================== */

renderAll();
