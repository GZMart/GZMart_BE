import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import timezone from "dayjs/plugin/timezone.js";

dayjs.extend(utc);
dayjs.extend(timezone);

const ICT = "Asia/Ho_Chi_Minh";

/**
 * Ngày + biên 00:00–23:59 theo giờ Việt Nam (tránh lệch UTC khi server chạy UTC).
 */
export const getVipDayBoundsICT = (date = new Date()) => {
  const d = dayjs(date).tz(ICT);
  return {
    ymd: d.format("YYYYMMDD"),
    start: d.startOf("day").toDate(),
    end: d.endOf("day").toDate(),
  };
};
