export type Fight = {
  id: number;
  event_date: string;
  event: string;
  weight_class: string;
  fighter_a: string;
  fighter_b: string;
  result: "a_win" | "draw" | "nc";
  a_was_champ: boolean;
  b_was_champ: boolean;
  method: string;
  round: number | null;
  time: string;
  notes: string | null;
  catchweight: boolean;
};
