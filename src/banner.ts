import chalk from "chalk";

export const EPX_BANNER = String.raw`
                 _       _
                | |     (_)
  _____  ___ __ | | __ _ _ _ __ __  __
 / _ \ \/ / '_ \| |/ _${"`"} | | '_ \\ \/ /
|  __/>  <| |_) | | (_| | | | | |>  <
 \___/_/\_\ .__/_|\__,_|_|_| |_/_/\_\
          | |
          |_|
`;

export function printBanner(): void {
  process.stderr.write(chalk.cyan(EPX_BANNER));
}
