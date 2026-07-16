import {
  createPrompt,
  isBackspaceKey,
  isDownKey,
  isEnterKey,
  isSpaceKey,
  isUpKey,
  useKeypress,
  usePagination,
  useState
} from "@inquirer/core";
import chalk from "chalk";

export interface SearchableAgentChoice {
  value: string;
  name: string;
  path: string;
}

export interface SearchableAgentPromptConfig {
  message: string;
  universal: string[];
  choices: SearchableAgentChoice[];
  pageSize?: number;
  noun?: string;
}

export const searchableAgentCheckbox = createPrompt<string[] | null, SearchableAgentPromptConfig>((config, done) => {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());

  const filtered = config.choices.filter((choice) => {
    const search = query.toLowerCase();
    return !search || choice.name.toLowerCase().includes(search) || choice.value.includes(search);
  });

  useKeypress((key) => {
    if (key.name === "escape") {
      done(null);
      return;
    }
    if (isEnterKey(key)) {
      done([...selected]);
      return;
    }
    if (key.ctrl && key.name === "a") {
      const everythingSelected = config.choices.every((choice) => selected.has(choice.value));
      setSelected(everythingSelected ? new Set() : new Set(config.choices.map((choice) => choice.value)));
      return;
    }
    if (isUpKey(key) || isDownKey(key)) {
      if (filtered.length === 0) return;
      const offset = isUpKey(key) ? -1 : 1;
      setActive((active + offset + filtered.length) % filtered.length);
      return;
    }
    if (isSpaceKey(key)) {
      const choice = filtered[active];
      if (!choice) return;
      const next = new Set(selected);
      if (next.has(choice.value)) next.delete(choice.value);
      else next.add(choice.value);
      setSelected(next);
      return;
    }
    if (isBackspaceKey(key)) {
      setQuery(query.slice(0, -1));
      setActive(0);
      return;
    }
    if (!key.ctrl && key.name.length === 1 && /^[a-z0-9._-]$/i.test(key.name)) {
      setQuery(query + key.name);
      setActive(0);
    }
  });

  const displayItems = filtered.length > 0
    ? filtered
    : [{ value: "__no_match__", name: "No matching agents", path: "" }];
  const page = usePagination({
        items: displayItems,
        active: filtered.length > 0 ? Math.min(active, filtered.length - 1) : 0,
        pageSize: config.pageSize ?? 9,
        renderItem({ item, isActive }) {
          if (item.value === "__no_match__") return chalk.dim("  No matching agents");
          const pointer = isActive ? chalk.cyan("❯") : " ";
          const marker = selected.has(item.value) ? chalk.green("●") : "○";
          const label = `${item.name} ${chalk.dim(`(${item.path})`)}`;
          return isActive ? `${pointer} ${marker} ${chalk.underline(label)}` : `${pointer} ${marker} ${label}`;
        }
      });

  const selectedNames = config.choices
    .filter((choice) => selected.has(choice.value))
    .map((choice) => choice.name);
  const universalPreview = config.universal.slice(0, 14).map((name) => `  ${chalk.green("•")} ${name}`);
  if (config.universal.length > 14) universalPreview.push(chalk.dim(`  ...and ${config.universal.length - 14} more`));
  const selectionPreview = [...config.universal, ...selectedNames];
  const selectionText = selectionPreview.length > 4
    ? `${selectionPreview.slice(0, 3).join(", ")} +${selectionPreview.length - 3} more`
    : selectionPreview.join(", ");

  const universalSection = config.universal.length > 0 ? [
    `│  ${chalk.dim("──")} Universal (.agents/skills) ${chalk.dim("── always included ──")}`,
    ...universalPreview.map((line) => `│ ${line}`),
    "│"
  ] : [];

  return [
    `${chalk.green("◇")}  ${config.choices.length + config.universal.length} ${config.noun ?? "agents"}`,
    `${chalk.green("◆")}  ${config.message}`,
    "│",
    ...universalSection,
    `│  ${chalk.dim("──")} ${config.universal.length > 0 ? "Additional agents" : `Available ${config.noun ?? "agents"}`} ${chalk.dim("────────────────")}`,
    `│  Search: ${query}${chalk.inverse(" ")}`,
    `│  ${chalk.dim("↑↓ move, space select, ctrl+a all, enter confirm, esc cancel")}`,
    "│",
    ...page.split("\n").map((line) => `│ ${line}`),
    "│",
    `│  ${chalk.green("Selected:")} ${selectionText}`,
    "\x1B[?25l"
  ].join("\n");
});
