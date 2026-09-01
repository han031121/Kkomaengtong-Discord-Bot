const WORDLE_PRINT_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function assertWordlePrintDate(printDate: string): void {
    if (!WORDLE_PRINT_DATE_PATTERN.test(printDate)) {
        throw new RangeError(`Wordle 날짜 형식이 올바르지 않습니다: ${printDate}`);
    }

    const date = new Date(`${printDate}T00:00:00.000Z`);

    if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== printDate) {
        throw new RangeError(`실제로 존재하지 않는 Wordle 날짜입니다: ${printDate}`);
    }
}

export function getPreviousWordlePrintDate(printDate: string): string {
    assertWordlePrintDate(printDate);

    const date = new Date(`${printDate}T00:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() - 1);
    return date.toISOString().slice(0, 10);
}

export function formatDateInTimeZone(date: Date, timeZone: string): string {
    const dateParts = new Intl.DateTimeFormat("en-US", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).formatToParts(date);
    const getPart = (type: Intl.DateTimeFormatPartTypes): string | undefined =>
        dateParts.find((part) => part.type === type)?.value;
    const year = getPart("year");
    const month = getPart("month");
    const day = getPart("day");

    if (year === undefined || month === undefined || day === undefined) {
        throw new Error("Wordle 날짜를 계산할 수 없습니다.");
    }

    return `${year}-${month}-${day}`;
}
