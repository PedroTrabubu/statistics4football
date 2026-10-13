import { describe, expect, it } from "vitest";
import { createCrestResolver, fileSlug, getTeamCrest, indexLogos, leagueLogo, logoSlug, teamInitials } from "./logos";

describe("logoSlug", () => {
  it("quita acentos, apóstrofos y mayúsculas", () => {
    expect(logoSlug("Nott'm Forest")).toBe("nottm-forest");
    expect(logoSlug("Ath Madrid")).toBe("ath-madrid");
    expect(logoSlug("Alavés")).toBe("alaves");
    expect(logoSlug("ESP-La Liga 2")).toBe("esp-la-liga-2");
  });
});

describe("fileSlug", () => {
  it("acepta el nombre del README y el de football-logos.cc", () => {
    expect(fileSlug("../teams/ath-bilbao.svg")).toBe("ath-bilbao");
    expect(fileSlug("../teams/esp-laliga1/spain_athletic-club.football-logos.cc.svg")).toBe("athletic-club");
    expect(fileSlug("../teams/fr-ligue1/france_rc-lens.football-logos.cc.png")).toBe("rc-lens");
  });
});

describe("indexLogos", () => {
  it("agrupa por carpeta, acepta SVG y PNG, y con los dos se queda el SVG", () => {
    const logos = indexLogos({
      "../assets/logos/teams/esp-laliga1/betis.png": "/betis.png",
      "../assets/logos/teams/esp-laliga1/getafe.svg": "/getafe.svg",
      "../assets/logos/teams/esp-laliga1/getafe.png": "/getafe.png",
    });
    expect(logos.get("esp-laliga1")?.get("betis")).toBe("/betis.png");
    expect(logos.get("esp-laliga1")?.get("getafe")).toBe("/getafe.svg");
  });
});

describe("createCrestResolver", () => {
  const resolve = createCrestResolver(
    {
      "../teams/esp-laliga1/spain_real-madrid.football-logos.cc.svg": "/real-madrid.svg",
      "../teams/esp-laliga1/spain_athletic-club.football-logos.cc.svg": "/athletic.svg",
      "../teams/esp-laliga1/spain_malaga.football-logos.cc.svg": "/malaga.svg",
      "../teams/esp-laliga2/spain_girona.football-logos.cc.svg": "/girona.svg",
      "../teams/esp-laliga2/celta.svg": "/celta-b-propio.svg",
      "../teams/esp-laliga1/spain_celta.football-logos.cc.svg": "/celta.svg",
    },
    { "ESP-La Liga": "esp-laliga1", "ESP-La Liga 2": "esp-laliga2" },
    { "ath-bilbao": "athletic-club" },
  );

  it("resuelve el nombre exacto", () => {
    expect(resolve("ESP-La Liga", "Real Madrid")).toBe("/real-madrid.svg");
  });

  it("resuelve las abreviaturas de la API con el mapa de alias", () => {
    expect(resolve("ESP-La Liga", "Ath Bilbao")).toBe("/athletic.svg");
  });

  it("ignora acentos y mayúsculas", () => {
    expect(resolve("ESP-La Liga", "Málaga")).toBe("/malaga.svg");
    expect(resolve("ESP-La Liga", "REAL MADRID")).toBe("/real-madrid.svg");
  });

  it("encuentra el escudo en otra liga (ascendidos y descendidos)", () => {
    expect(resolve("ESP-La Liga", "Girona")).toBe("/girona.svg");
    expect(resolve(null, "Girona")).toBe("/girona.svg");
  });

  it("prefiere la carpeta de la liga del partido", () => {
    expect(resolve("ESP-La Liga 2", "Celta")).toBe("/celta-b-propio.svg");
    expect(resolve("ESP-La Liga", "Celta")).toBe("/celta.svg");
  });

  it("devuelve undefined si el equipo no tiene escudo", () => {
    expect(resolve("ESP-La Liga", "Equipo Inventado")).toBeUndefined();
    expect(resolve("ESP-La Liga", "")).toBeUndefined();
  });
});

describe("escudos del proyecto", () => {
  // Equipos de la temporada 26/27 tal como los da la API.
  const CURRENT: Record<string, string[]> = {
    "ENG-Premier League": [
      "Arsenal", "Aston Villa", "Bournemouth", "Brentford", "Brighton", "Chelsea", "Coventry", "Crystal Palace",
      "Everton", "Fulham", "Hull", "Ipswich", "Leeds", "Liverpool", "Man City", "Man United", "Newcastle",
      "Nott'm Forest", "Sunderland", "Tottenham",
    ],
    "ESP-La Liga": [
      "Alaves", "Ath Bilbao", "Ath Madrid", "Barcelona", "Betis", "Celta", "Elche", "Espanol", "Getafe",
      "La Coruna", "Levante", "Malaga", "Osasuna", "Real Madrid", "Santander", "Sevilla", "Sociedad", "Valencia",
      "Vallecano", "Villarreal",
    ],
    "ESP-La Liga 2": [
      "Albacete", "Almeria", "Andorra", "Burgos", "Cadiz", "Castellon", "Celta B", "Ceuta", "Cordoba", "Eibar",
      "Eldense", "Girona", "Granada", "Las Palmas", "Leganes", "Mallorca", "Oviedo", "Sabadell", "Sociedad B",
      "Sp Gijon", "Tenerife", "Valladolid",
    ],
    "FRA-Ligue 1": [
      "Angers", "Auxerre", "Brest", "Le Havre", "Le Mans", "Lens", "Lille", "Lorient", "Lyon", "Marseille",
      "Monaco", "Nice", "Paris FC", "Paris SG", "Rennes", "Strasbourg", "Toulouse", "Troyes",
    ],
  };

  it("todos los equipos de la temporada tienen escudo salvo los que faltan en la carpeta", () => {
    const missing = Object.entries(CURRENT).flatMap(([league, teams]) =>
      teams.filter((team) => getTeamCrest(league, team) === undefined),
    );
    expect(missing).toEqual([]);
  });

  // Los 36 de la fase de liga 26/27, con los nombres de ESPN (los de nuestras
  // ligas, con el suyo de siempre).
  const CHAMPIONS_2627 = [
    "AEK Athens", "AS Roma", "Arsenal", "Aston Villa", "Ath Madrid", "Barcelona", "Bayern Munich", "Betis",
    "Bodo/Glimt", "Borussia Dortmund", "Club Brugge", "Como", "FC Porto", "Fenerbahce", "Feyenoord Rotterdam",
    "Galatasaray", "Internazionale", "LASK Linz", "Lens", "Lille", "Liverpool", "Man City", "Man United", "Napoli",
    "PSV Eindhoven", "Paris SG", "RB Leipzig", "Real Madrid", "Sabah FK", "Shakhtar Donetsk", "Slavia Prague",
    "Slovan Bratislava", "Sporting CP", "VfB Stuttgart", "Viking FK", "Villarreal",
  ];

  it("todos los equipos de la Champions 26/27 tienen escudo", () => {
    expect(CHAMPIONS_2627.filter((team) => getTeamCrest("INT-Champions League", team) === undefined)).toEqual([]);
  });

  it("cada equipo de la temporada tiene su propio escudo (salvo los filiales)", () => {
    const urls = Object.entries(CURRENT).flatMap(([league, teams]) =>
      teams.filter((t) => !t.endsWith(" B")).map((team) => getTeamCrest(league, team)).filter(Boolean),
    );
    expect(new Set(urls).size).toBe(urls.length);
  });

  it("las cuatro ligas tienen logo", () => {
    for (const code of Object.keys(CURRENT)) expect(leagueLogo(code)).not.toBeNull();
  });
});

describe("teamInitials", () => {
  it("dos letras: las dos primeras de una palabra o las iniciales de dos", () => {
    expect(teamInitials("Tenerife")).toBe("TE");
    expect(teamInitials("West Brom")).toBe("WB");
    expect(teamInitials("Nott'm Forest")).toBe("NF");
    expect(teamInitials("Alavés")).toBe("AL");
  });
});
