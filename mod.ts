/// <reference lib="esnext" />
import {readLines} from "https://deno.land/std/io/bufio.ts";


export class HttpTarget {
    comment?: string
    method: string
    url: string
    headers?: Headers
    body?: Blob | BufferSource | FormData | URLSearchParams | ReadableStream<Uint8Array> | string
    checker?: string

    constructor(method: string, url: string) {
        this.method = method;
        this.url = url;
    }

    addHeader(name: string, value: string) {
        if (!this.headers) {
            this.headers = new Headers();
        }
        this.headers.set(name, value);
    }

    addCheckerLine(line: string) {
        this.checker = this.checker + "\r\n" + line;
    }

    addBodyLine(line: string) {
        if (!this.body) {
            this.body = line;
        } else {
            this.body = this.body + "\r\n" + line;
        }
    }

    isEmpty(): boolean {
        return this.method === "" && this.url === "";
    }

    isMatch(word: string): boolean {
        if (this.comment && this.comment.indexOf(word) >= 0) {
            return true;
        }
        return this.url.indexOf(word) >= 0;
    }

    clean() {
        if (typeof this.body === "string") {
            if (this.body && this.body.endsWith("\r\n")) {
                this.body = this.body.substr(0, this.body.length - 2)
            }
        }
    }

    replace(env?: { [name: string]: string }) {
        if (typeof this.body === "string") {
            if (this.body.startsWith("< ")) { // import content from file
                this.body = Deno.readFileSync(this.body.trim().substr(2));
            }
        }
    }
}

export function runTarget(target: HttpTarget) {
    console.log(`${target.method} ${target.url}`)
    fetch(target.url, {
        method: target.method, // or 'PUT'
        headers: target.headers,
        body: target.body
    }).then(res => {
        console.log("")
        res.headers.forEach((value, key) => {
            console.log(`${key}: ${value}`);
        })
        let body: Promise<any | string | ArrayBuffer> | null = null;
        const contentType = res.headers.get("content-type");
        if (contentType) {
            if (contentType.startsWith("text/")) {
                body = res.text();
            } else if (contentType.indexOf("json")) {
                body = res.json();
            }
        }
        if (!body) {
            body = res.arrayBuffer();
        }
        return body;
    }).then(body => {
        console.log("")
        if (typeof body === 'string') {
            console.log(body)
        } else if (typeof body === 'object') {
            // json reformat
            console.log(JSON.stringify(body, null, 2));
        } else {
            console.log(new Uint8Array(body));
        }
    }).catch(error => console.error(error))
}

export async function parseTargets(filePath: string): Promise<HttpTarget[]> {
    const file = await Deno.open(filePath);
    let targets: HttpTarget[] = [];
    let httpTarget = new HttpTarget("", "");
    for await (const l of readLines(file)) {
        const line = l.trim() as string;
        if (line === "" && httpTarget.isEmpty()) { // ignore empty line before http target

        } else if (line.startsWith("###")) { // separator
            let comment = line.substr(3).trim();
            if (httpTarget.isEmpty()) {
                httpTarget.comment = comment;
            } else {
                httpTarget.clean();
                targets.push(httpTarget);
                httpTarget = new HttpTarget("", "");
                httpTarget.comment = comment;
            }
        } else if (line.startsWith("//")) { //comment
            if (!httpTarget.comment) {
                httpTarget.comment = line.substr(2).trim();
            }
        } else if ((line.startsWith("GET ") || line.startsWith("POST ")) && httpTarget.method === "") { // HTTP method & URL
            let parts = line.split(" ", 3); // format as 'POST URL HTTP/1.1'
            httpTarget.method = parts[0];
            httpTarget.url = parts[1].trim();
        } else if (line.indexOf(":") > 0 && httpTarget.body === undefined) { // headers
            let parts = line.split(":", 2);
            httpTarget.addHeader(parts[0].trim(), parts[1].trim());
        } else {
            if (!(line === "" && httpTarget.body === undefined)) {
                if (line.startsWith("> {%")) { // indicate checker
                    httpTarget.checker = "";
                } else if (line.startsWith("%}")) { // end of checker

                } else {
                    if (httpTarget.checker !== undefined) { //add checker line
                        httpTarget.addCheckerLine(l);
                    } else { // add body line
                        httpTarget.addBodyLine(l);
                    }
                }
            }
        }
    }
    if (!httpTarget.isEmpty()) {
        targets.push(httpTarget)
    }
    return targets;
}

export async function findHttpTarget(httpFile: string, word?: string): Promise<HttpTarget | null> {
    let targets = await parseTargets(httpFile);
    if (word === undefined || word === "") {
        return targets[0];
    }
    for (const target of targets) {
        if (target.isMatch(word)) {
            return target;
        }
    }
    return null;
}


