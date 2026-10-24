import { useTranslation } from "react-i18next";
import { type ThemePreference, useTheme } from "../lib/theme";
import { HeaderMenu } from "./HeaderMenu";
import { IconMonitor, IconMoon, IconSun } from "./icons";

const OPTIONS: { value: ThemePreference; Icon: typeof IconSun }[] = [
  { value: "system", Icon: IconMonitor },
  { value: "light", Icon: IconSun },
  { value: "dark", Icon: IconMoon },
];

/** Selector de tema de la barra superior: un botón con el icono de la opción
 * elegida que abre un menú (Sistema / Claro / Oscuro). */
export function ThemeSwitch() {
  const { t } = useTranslation();
  const { preference, setPreference } = useTheme();
  const current = OPTIONS.find((option) => option.value === preference) ?? OPTIONS[0];
  const label = t("common:theme.button", { theme: t(`common:theme.option.${current.value}`) });

  return (
    <HeaderMenu
      className="theme-switch"
      options={OPTIONS.map(({ value, Icon }) => ({
        value,
        label: t(`common:theme.option.${value}`),
        icon: <Icon aria-hidden="true" />,
      }))}
      value={current.value}
      onChange={setPreference}
      buttonLabel={label}
      buttonContent={<current.Icon aria-hidden="true" />}
      menuLabel={t("common:theme.menu")}
    />
  );
}
