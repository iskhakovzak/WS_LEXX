/**
 * «WS originals» photo files (public/backgrounds) — GENERATED with the files by the background export script; edit the
 * export, not this table. Per scene: widths exported (`<file>-<width>.webp`, 16:10), the brightest / 98th-percentile /
 * darkest grey measured over every exported file (the scrim maths in scenes.ts), the subject's horizontal focus
 * (object-position, so phones crop to it) and the Commons credit (CREDITS.md there).
 */
export type SceneCredit = { author: string; license: string; source: string };
export type ScenePhoto = { file: string; widths: readonly number[]; max: number; p98: number; min: number; focusX: number; credit: SceneCredit };

const commons = (file: string) => `https://commons.wikimedia.org/wiki/File:${file}`;

export const SCENE_PHOTOS = {
  "porsche-gt3rs": { file: "porsche-gt3rs", widths: [1280, 1920, 2560, 3840], max: 227, p98: 155, min: 0, focusX: 50, credit: { author: "Matti Blume", license: "CC BY-SA 4.0", source: commons("Porsche_911_GT3_RS,_GIMS_2018,_Le_Grand-Saconnex_(1X7A0084).jpg") } },
  "porsche-wheel": { file: "porsche-wheel", widths: [1280, 1920, 2560, 3840], max: 234, p98: 180, min: 0, focusX: 50, credit: { author: "Matti Blume", license: "CC BY-SA 4.0", source: commons("Porsche_911_GT3_RS,_GIMS_2018,_Le_Grand-Saconnex_(1X7A0077).jpg") } },
  laocoon: { file: "laocoon", widths: [1280, 1920, 2560, 3840], max: 253, p98: 241, min: 0, focusX: 66, credit: { author: "LivioAndronico (2014), Notwist", license: "CC BY-SA 4.0", source: commons("Laocoon_and_His_Sons_black.jpg") } },
  discobolus: { file: "discobolus", widths: [1280, 1920, 2560, 3840], max: 247, p98: 162, min: 0, focusX: 68, credit: { author: "Livioandronico2013", license: "CC BY-SA 4.0", source: commons("Discobolus_in_National_Roman_Museum_Palazzo_Massimo_alle_Terme.JPG") } },
  hercules: { file: "hercules", widths: [1280, 1920, 2560, 3840], max: 240, p98: 154, min: 0, focusX: 70, credit: { author: "Marie-Lan Nguyen (2011)", license: "CC BY 2.5", source: commons("Herakles_Farnese_MAN_Napoli_Inv6001_n01.jpg") } },
  zeus: { file: "zeus", widths: [1280, 1920, 2560, 3840], max: 249, p98: 128, min: 0, focusX: 68, credit: { author: "Jastrow (2006)", license: "Public domain", source: commons("Zeus_Otricoli_Pio-Clementino_Inv257.jpg") } },
  "porsche-gt3": { file: "porsche-gt3", widths: [1280, 1920, 2560, 3840], max: 245, p98: 148, min: 0, focusX: 50, credit: { author: "Matti Blume", license: "CC BY-SA 4.0", source: commons("Porsche_911_GT3_Touring,_IAA_2017,_Frankfurt_(1Y7A2766).jpg") } },
  "porsche-turbo-s": { file: "porsche-turbo-s", widths: [1280, 1920, 2560, 3840], max: 247, p98: 191, min: 0, focusX: 50, credit: { author: "Matti Blume", license: "CC BY-SA 4.0", source: commons("Porsche_911_Turbo_S_Exclusive_Series,_IAA_2017,_Frankfurt_(1Y7A2811).jpg") } },
  "porsche-918": { file: "porsche-918", widths: [1280, 1920, 2560, 3840], max: 236, p98: 222, min: 0, focusX: 50, credit: { author: "Thomas Wolf, www.foto-tw.de", license: "CC BY-SA 3.0 DE", source: commons("Porsche_918_Spyder_IAA_2013.jpg") } },
  "carrera-gt": { file: "carrera-gt", widths: [1280, 1920, 2560, 3840], max: 242, p98: 180, min: 0, focusX: 50, credit: { author: "Calreyn88", license: "CC BY-SA 4.0", source: commons("Porsche_Carrera_GT_(32820).jpg") } },
  "porsche-rs27": { file: "porsche-rs27", widths: [1280, 1920, 2560, 3840], max: 236, p98: 224, min: 0, focusX: 47, credit: { author: "MrWalkr", license: "CC BY-SA 4.0", source: commons("1974_Porsche_911_Carrera_RS_2.7_BS_O24.jpg") } },
  "ferrari-f40": { file: "ferrari-f40", widths: [1280, 1920, 2560, 3840], max: 241, p98: 137, min: 0, focusX: 50, credit: { author: "Alexander-93", license: "CC BY-SA 4.0", source: commons("Ferrari_F40_GIMS_2024_1X7A2271.jpg") } },
  parthenon: { file: "parthenon", widths: [1280, 1920, 2560, 3840], max: 234, p98: 173, min: 0, focusX: 50, credit: { author: "Jebulon", license: "CC0", source: commons("Parthenon_east_side_Acropolis_Athens,_Greece.jpg") } },
  sounion: { file: "sounion", widths: [1280, 1920, 2560, 3840], max: 248, p98: 158, min: 0, focusX: 62, credit: { author: "Fotis Petrakogiannis", license: "CC BY-SA 4.0", source: commons("Sounion_-_Temple_of_Poseidon_at_night_(DSC_7633-2).jpg") } },
  nike: { file: "nike", widths: [1280, 1920, 2560, 3840], max: 247, p98: 176, min: 0, focusX: 66, credit: { author: "Wilfredor", license: "CC0", source: commons("Nike_of_Samothrace_from_Paris.jpg") } },
  riace: { file: "riace", widths: [1280, 1920, 2560, 3840], max: 246, p98: 121, min: 0, focusX: 66, credit: { author: "Benjamin Smith", license: "CC BY-SA 4.0", source: commons("Reggio_Calabria_-_Museo_archeologico_nazionale_-_Bronzi_di_Riace_-_09.jpg") } },
  delphi: { file: "delphi", widths: [1280, 1920, 2560, 3840], max: 243, p98: 215, min: 0, focusX: 50, credit: { author: "HerrAdams", license: "CC BY-SA 4.0", source: commons("Delphi,_Tholos_2015-09_(3).jpg") } },
  matterhorn: { file: "matterhorn", widths: [1280, 1920, 2560, 3840], max: 240, p98: 183, min: 0, focusX: 42, credit: { author: "Giles Laurent", license: "CC BY-SA 4.0", source: commons("050_Matterhorn_with_plane_flying_night_sky_Photo_by_Giles_Laurent.jpg") } },
  storm: { file: "storm", widths: [1280, 1920, 2560, 3840], max: 194, p98: 170, min: 0, focusX: 50, credit: { author: "Blair Fraser", license: "CC0", source: commons("Rough_ocean_crashing_on_beach_(Unsplash).jpg") } },
  manhattan: { file: "manhattan", widths: [1280, 1920, 2560, 3840], max: 255, p98: 215, min: 0, focusX: 50, credit: { author: "VynedJ", license: "CC BY 4.0", source: commons("Lower_Manhattan_night_skyline_20261003_–_1.jpg") } },
  nyse: { file: "nyse", widths: [1280, 1920, 2560, 3840], max: 243, p98: 175, min: 0, focusX: 50, credit: { author: "Georgio (Flickr)", license: "CC BY 2.0", source: commons("NYSE_lit_up_at_night_(3122761205).jpg") } },
} as const satisfies Record<string, ScenePhoto>;
