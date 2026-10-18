import { checkinAction } from "../actions";
import type { SearchParams } from "../flash";

// 게스트가 보는 공개 페이지. 이름·연락처는 받지 않고 인원별 성별·나이만 받는다.
const TEXT = {
  ko: {
    title: "숙박 전 간단한 정보 입력",
    intro: "숙소 운영 통계를 위해 함께 묵는 분들의 성별과 나이만 받습니다. 이름이나 연락처는 받지 않습니다.",
    confirmation: "예약 번호",
    checkIn: "체크인 날짜",
    person: "투숙객",
    gender: "성별",
    age: "나이",
    male: "남성",
    female: "여성",
    other: "기타",
    undisclosed: "밝히지 않음",
    consent: "숙소 운영 통계 목적으로 성별·나이를 수집하는 데 동의합니다. 이름과 연락처는 수집하지 않으며, 입력하지 않아도 숙박에는 영향이 없습니다.",
    submit: "제출",
    add: "투숙객 추가",
    done: "감사합니다. 입력이 완료되었습니다.",
    notfound: "예약을 찾지 못했습니다. 예약 번호와 체크인 날짜를 확인해 주세요.",
    invalid: "입력값을 확인해 주세요.",
  },
  en: {
    title: "Quick guest details before your stay",
    intro: "For our booking statistics we only ask the gender and age of each guest. We do not collect names or contact details.",
    confirmation: "Booking / confirmation number",
    checkIn: "Check-in date",
    person: "Guest",
    gender: "Gender",
    age: "Age",
    male: "Male",
    female: "Female",
    other: "Other",
    undisclosed: "Prefer not to say",
    consent: "I agree that gender and age are collected for the host's statistics. No names or contact details are collected, and skipping this form does not affect your stay.",
    submit: "Submit",
    add: "Add guest",
    done: "Thank you. Your details were saved.",
    notfound: "We couldn't find that booking. Please check the number and check-in date.",
    invalid: "Please check your input.",
  },
  zh: {
    title: "入住前简单信息填写",
    intro: "为了住宿统计，我们只收集每位住客的性别和年龄，不收集姓名或联系方式。",
    confirmation: "预订号",
    checkIn: "入住日期",
    person: "住客",
    gender: "性别",
    age: "年龄",
    male: "男",
    female: "女",
    other: "其他",
    undisclosed: "不愿透露",
    consent: "我同意为住宿统计目的收集性别和年龄。不收集姓名和联系方式，不填写也不影响入住。",
    submit: "提交",
    add: "添加住客",
    done: "谢谢，已提交。",
    notfound: "未找到该预订，请检查预订号和入住日期。",
    invalid: "请检查填写内容。",
  },
} as const;

type Lang = keyof typeof TEXT;
const MAX_GUESTS = 8;

export default async function CheckinPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const lang: Lang = params.lang === "ko" || params.lang === "zh" ? params.lang : "en";
  const t = TEXT[lang];
  const status = typeof params.status === "string" ? params.status : null;
  const guests = Math.min(MAX_GUESTS, Math.max(1, Number(params.guests) || 2));

  return (
    <main style={{ maxWidth: 520 }}>
      <div className="row" style={{ justifyContent: "flex-end" }}>
        <a href="?lang=ko">한국어</a>
        <a href="?lang=en">English</a>
        <a href="?lang=zh">中文</a>
      </div>
      <h1>{t.title}</h1>
      {status === "done" ? (
        <div className="notice">{t.done}</div>
      ) : (
        <>
          {status === "notfound" && <div className="notice warn">{t.notfound}</div>}
          {status === "invalid" && <div className="notice warn">{t.invalid}</div>}
          <p className="muted">{t.intro}</p>
          <form action={checkinAction} className="stack panel">
            <input type="hidden" name="lang" value={lang} />
            <label>{t.confirmation}<input name="confirmation" required autoComplete="off" /></label>
            <label>{t.checkIn}<input type="date" name="checkIn" required /></label>
            {Array.from({ length: guests }, (_, i) => (
              <div className="row" key={i}>
                <strong style={{ width: 70 }}>{t.person} {i + 1}</strong>
                <label>
                  {t.gender}
                  <select name="gender" defaultValue="undisclosed">
                    <option value="male">{t.male}</option>
                    <option value="female">{t.female}</option>
                    <option value="other">{t.other}</option>
                    <option value="undisclosed">{t.undisclosed}</option>
                  </select>
                </label>
                <label>
                  {t.age}
                  <input name="age" type="number" min={0} max={120} style={{ width: 90 }} />
                </label>
              </div>
            ))}
            {guests < MAX_GUESTS && <a href={`?lang=${lang}&guests=${guests + 1}`}>+ {t.add}</a>}
            <label className="row" style={{ alignItems: "flex-start" }}>
              <input type="checkbox" name="consent" value="yes" required />
              <span>{t.consent}</span>
            </label>
            <button type="submit">{t.submit}</button>
          </form>
        </>
      )}
    </main>
  );
}
