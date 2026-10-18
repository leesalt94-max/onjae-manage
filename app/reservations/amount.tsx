import type { Amounts } from "@/lib/amounts";
import { money } from "@/lib/format";

// 금액을 누르면 어떻게 나온 숫자인지 펼쳐 보여 준다. 역산한 값에는 * 표시.
export function AmountCell({ amounts, field, currency }: { amounts: Amounts; field: "guestPaid" | "commission"; currency: string }) {
  const value = amounts[field];
  if (value === null) return <>-</>;
  if (amounts.steps.length === 0) return <>{money(value, currency)}</>;
  return (
    <details className="calc">
      <summary>{money(value, currency)}{amounts.estimated && <sup>*</sup>}</summary>
      <CalcBox amounts={amounts} currency={currency} />
    </details>
  );
}

export function CalcBox({ amounts, currency, inline }: { amounts: Amounts; currency: string; inline?: boolean }) {
  return (
    <div className={inline ? "calc-inline" : "calc-box"}>
      <table>
        <tbody>
          {amounts.steps.map((s) => (
            <tr key={s.label}>
              <td>{s.label}{s.note && <div className="muted small">{s.note}</div>}</td>
              <td className="num">{money(s.value, currency)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted small">{amounts.note}</p>
    </div>
  );
}
