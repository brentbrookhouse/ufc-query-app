import { formatDate, getOutcome } from "@/lib/format";
import type { Fight } from "@/lib/types";

export default function FightTable({ results }: { results: Fight[] }) {
  if (results.length === 0) {
    return null;
  }

  return (
    <>
      <div className="overflow-x-auto rounded border border-zinc-200 dark:border-zinc-800">
        <table className="w-full min-w-[800px] text-left text-sm">
          <thead className="bg-zinc-100 text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
            <tr>
              <th className="px-3 py-2 font-medium">Date</th>
              <th className="px-3 py-2 font-medium">Event</th>
              <th className="px-3 py-2 font-medium">Weight Class</th>
              <th className="px-3 py-2 font-medium">Winner</th>
              <th className="px-3 py-2 font-medium">Loser</th>
              <th className="px-3 py-2 font-medium">Method</th>
              <th className="px-3 py-2 font-medium">Rd</th>
              <th className="px-3 py-2 font-medium">Time</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {results.map((fight) => {
              const outcome = getOutcome(fight);
              return (
                <tr key={fight.id}>
                  <td className="whitespace-nowrap px-3 py-2">
                    {formatDate(fight.event_date)}
                  </td>
                  <td className="px-3 py-2">{fight.event}</td>
                  <td className="whitespace-nowrap px-3 py-2">
                    {fight.weight_class}
                    {fight.catchweight ? " *" : ""}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">
                    {outcome.winnerCell}
                  </td>
                  <td
                    className={
                      outcome.decisive
                        ? "whitespace-nowrap px-3 py-2"
                        : "whitespace-nowrap px-3 py-2 italic text-zinc-500 dark:text-zinc-400"
                    }
                  >
                    {outcome.loserCell}
                  </td>
                  <td className="px-3 py-2">{fight.method}</td>
                  <td className="px-3 py-2">{fight.round ?? ""}</td>
                  <td className="whitespace-nowrap px-3 py-2">{fight.time}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-zinc-500 dark:text-zinc-500">
        * catchweight bout bucketed into the listed division
      </p>
    </>
  );
}
