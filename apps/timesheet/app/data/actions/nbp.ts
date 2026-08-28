'use server'

import { subDays, format } from 'date-fns'

/**
 * Fetch the NBP mid exchange rate for a given currency and date.
 * Falls back to previous business days (up to 5 days back) if the rate
 * is unavailable (weekends/holidays return 404 from NBP).
 * Returns 1.0 for PLN (no API call needed).
 */
export async function fetchNbpRate(currency: string, date: string): Promise<number> {
    if (currency === 'PLN') return 1.0

    const code = currency.toUpperCase()
    let currentDate = new Date(date)

    for (let attempt = 0; attempt < 6; attempt++) {
        const dateStr = format(currentDate, 'yyyy-MM-dd')
        const url = `https://api.nbp.pl/api/exchangerates/rates/a/${code}/${dateStr}/?format=json`

        try {
            const res = await fetch(url, { cache: 'no-store' })
            if (res.ok) {
                const json = await res.json()
                const mid = json?.rates?.[0]?.mid
                if (typeof mid === 'number' && mid > 0) return mid
            }
            // 404 means no rate for that date — try previous day
        } catch {
            // Network error — try previous day
        }

        currentDate = subDays(currentDate, 1)
    }

    // If all attempts fail, throw so the caller can handle it
    throw new Error(`Could not fetch NBP rate for ${currency} around ${date}`)
}
