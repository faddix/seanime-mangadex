/// <reference path="./types/manga-provider.d.ts" />
/// <reference path="./types/core.d.ts" />

type MangadexManga = {
    id: string;
    type: string;
    attributes: MangadexMangaAttributes;
    relationships: MangadexMangaRelationship[];
};

type MangadexMangaAttributes = {
    altTitles: Record<string, string>[];
    title: Record<string, string>;
    year: number;
};

type MangadexMangaRelationship = {
    id: string;
    type: string;
    related: string;
    attributes: Record<string, any>;
};

type MangadexErrorResponse = {
    id: string;
    status: string;
    code: string;
    title: string;
    detail: string;
};

type MangadexChapterData = {
    id: string;
    attributes: MangadexChapterAttributes;
};

type MangadexChapterAttributes = {
    title: string;
    volume: string;
    chapter: string;
    updatedAt: string;
};

// DEVNOTE: Each chapter ID is a unique string provided by Mangadex

class Provider {
    private url = "https://api.mangadex.org";
    private baseUrl = "https://uploads.mangadex.org";

    private headers = {
        "User-Agent": "Seanime-MangaDex-Provider/1.0",
    };

    getSettings(): Settings {
        return {
            supportsMultiScanlator: false,
            supportsMultiLanguage: false,
        };
    }

    async search(opts: QueryOptions): Promise<SearchResult[]> {
        const ret: SearchResult[] = [];
        const retManga: MangadexManga[] = [];

        for (let i = 0; i < 1; i++) {
            const resp = await fetch(
                `${this.url}/manga?title=${encodeURIComponent(opts.query)}&limit=25&offset=${25 * i}&order[relevance]=desc&contentRating[]=safe&contentRating[]=suggestive&includes[]=cover_art`,
                {
                    headers: this.headers,
                },
            );

            if (!resp.ok) {
                console.error("mangadex: request failed", {
                    status: resp.status,
                });
                throw new Error(
                    `failed to decode response: status ${resp.status}`,
                );
            }

            const data: { data: MangadexManga[] } = await resp.json();

            retManga.push(...data.data);
        }

        for (let manga of retManga) {
            const altTitles: string[] = [];

            for (let title of manga.attributes.altTitles) {
                if ("en" in title) altTitles.push(title["en"]);
                if ("jp" in title) altTitles.push(title["jp"]);
                if ("ja" in title) altTitles.push(title["ja"]);
            }

            const t = getTitle(manga.attributes);

            let img: string;

            for (let relation of manga.relationships) {
                if (relation.type == "cover_art") {
                    if ("fileName" in relation.attributes) {
                        img = `${this.baseUrl}/covers/${manga.id}/${relation.attributes["fileName"]}.512.jpg`;
                    }
                }
            }

            let format = manga.type.toUpperCase();

            if (format == "ADAPTATION") {
                format = "MANGA";
            }

            const result: SearchResult = {
                id: manga.id,
                title: t,
                synonyms: altTitles,
                image: img!,
                imageHeaders: {
                    Referer: "https://mangadex.org/",
                },
                year: manga.attributes.year,
            };

            ret.push(result);
        }

        return ret;
    }

    async findChapters(id: string): Promise<ChapterDetails[]> {
        const ret: ChapterDetails[] = [];

        console.debug("mangadex: Finding chapters", { mangaId: id });

        for (let page = 0; page <= 1; page++) {
            const resp = await fetch(
                `${this.url}/manga/${id}/feed?limit=500&translatedLanguage[]=en&includes[]=scanlation_group&includes[]=user&order[volume]=desc&order[chapter]=desc&offset=${500 * page}&contentRating[]=safe&contentRating[]=suggestive&contentRating[]=erotica&contentRating[]=pornographic`,
                {
                    headers: this.headers,
                },
            );

            if (!resp.ok) {
                console.error("mangadex: Request failed", {
                    status: resp.status,
                });
                throw new Error(
                    `failed to decode response: status ${resp.status}`,
                );
            }

            const data: {
                result: string;
                errors: MangadexErrorResponse[];
                data: MangadexChapterData[];
            } = await resp.json();

            if (data.result == "error") {
                console.error("mangadex: Could not find chapters", {
                    error: data.errors[0].title,
                    detail: data.errors[0].detail,
                });
                throw new Error(
                    `could not find chapters: ${data.errors[0].detail}`,
                );
            }

            data.data.reverse();

            const chapterMap: Record<string, ChapterDetails> = {};
            let idx = ret.length;

            for (let chapter of data.data) {
                if (chapter.attributes.chapter == "") continue;

                const title = `Chapter ${chapter.attributes.chapter} `;

                if (chapter.attributes.chapter in chapterMap) continue;

                chapterMap[chapter.attributes.chapter] = {
                    id: chapter.id,
                    url: "",
                    title: title,
                    index: idx,
                    chapter: chapter.attributes.chapter,
                    updatedAt: chapter.attributes.updatedAt,
                };

                idx++;
            }

            const chapters: ChapterDetails[] = [];

            for (let chapter of Object.values(chapterMap)) {
                chapters.push(chapter);
            }

            chapters.sort((a, b) => a.index - b.index);

            if (chapters.length > 0) ret.push(...chapters);
            else break;
        }

        return ret;
    }

    async findChapterPages(id: string): Promise<ChapterPage[]> {
        const ret: ChapterPage[] = [];

        console.debug("mangadex: Finding chapter pages", {
            chapterId: id,
        });

        const resp = await fetch(
            `${this.url}/at-home/server/${id}`,
            {
                headers: this.headers,
            },
        );

        if (!resp.ok) {
            console.error("mangadex: Request failed", {
                status: resp.status,
            });
            throw new Error(
                `failed to decode response: status ${resp.status}`,
            );
        }

        const data: {
            baseUrl: string;
            chapter: {
                hash: string;
                data: string[];
            };
        } = await resp.json();

        for (let i = 0; i < data.chapter.data.length; i++) {
            const page = data.chapter.data[i];

            ret.push({
                url: `${data.baseUrl}/data/${data.chapter.hash}/${page}`,
                index: i,
                headers: {
                    Referer: "https://mangadex.org",
                },
            });
        }

        return ret;
    }
}

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

const getTitle = (attributes: MangadexMangaAttributes): string => {
    const altTitles = attributes.altTitles;
    const title = attributes.title;

    if ("en" in title && title["en"] != "") return title["en"];

    let enAltTitle: string = "";

    for (let altTitle of altTitles) {
        if ("en" in altTitle) {
            enAltTitle = altTitle["en"];
            break;
        }
    }

    if (enAltTitle != "") return enAltTitle;

    // Check for other language titles

    if ("ja-ro" in title) return title["ja-ro"];
    if ("jp-ro" in title) return title["jp-ro"];
    if ("jp" in title) return title["jp"];
    if ("ja" in title) return title["ja"];
    if ("ko" in title) return title["ko"];

    // Check alt titles for other languages

    for (let altTitle of altTitles) {
        if ("ja-ro" in altTitle) return altTitle["ja-ro"];
    }

    for (let altTitle of altTitles) {
        if ("jp-ro" in altTitle) return altTitle["jp-ro"];
    }

    for (let altTitle of altTitles) {
        if ("jp" in altTitle) return altTitle["jp"];
    }

    for (let altTitle of altTitles) {
        if ("ja" in altTitle) return altTitle["ja"];
    }

    for (let altTitle of altTitles) {
        if ("ko" in altTitle) return altTitle["ko"];
    }

    return "";
};
