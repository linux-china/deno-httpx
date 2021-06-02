/// <reference lib="esnext" />
import {readLines} from "https://deno.land/std@0.97.0/io/bufio.ts";
import * as fs from "https://deno.land/std@0.97.0/fs/mod.ts";
import {v4} from "https://deno.land/std@0.97.0/uuid/mod.ts";
import {HttpClient, HttpResponse} from "./http-client.ts";
import {assertEquals} from "https://deno.land/std@0.97.0/testing/asserts.ts";
import * as base64 from "https://deno.land/std@0.97.0/encoding/base64.ts";

const textEncoder = new TextEncoder();

const httpClientEnvFile = "http-client.env.json";

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

    replace(env?: string) {
        // replace {{variable}}
        if (env && fs.existsSync(httpClientEnvFile)) {
            let fileText = Deno.readTextFileSync(httpClientEnvFile);
            let json: any = JSON.parse(fileText);
            if (json[env]) {
                let context = json[env];
                context['$uuid'] = v4.generate();
                context['$timestamp'] = Date.now();
                context['$randomInt'] = Math.floor(Math.random() * 1001); // random int 0 - 1000
                this.url = replaceVariables(this.url, context);
                if (typeof this.body === "string") {
                    this.body = replaceVariables(this.body, context);
                }
                if (this.headers) {
                    this.headers.forEach((value, key, parent) => {
                        parent.set(key, replaceVariables(value, context));
                        if (key.toLocaleLowerCase() === "authorization" && value.startsWith("Basic ")) {
                            // todo ":" to concat to user name and password
                        }
                    })
                }
            }
        }
        if (typeof this.body === "string") {
            if (this.body.startsWith("< ")) { // import content from file
                this.body = Deno.readFileSync(this.body.trim().substr(2));
            }
        }

    }
}

function replaceVariables(text: string, context: { [name: string]: string }): string {
    if (text.indexOf("{{") >= 0) {
        // todo variable replace
    }
    return text;
}

export function runTarget(target: HttpTarget) {
    if (target.comment) {
        console.log(`### ${target.comment}`)
    }
    console.log(`${target.method} ${target.url}`);
    let checkerContext: { [name: string]: any } = {}
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
        if (target.checker) {
            checkerContext['client'] = buildHttpClient(target);
            checkerContext['response'] = buildHttpResponse(res, body);
        }
        return body;
    }).then(body => {
        console.log("");
        if (typeof body === 'string') {
            console.log(body);
        } else if (typeof body === 'object') {
            // json reformat
            console.log(JSON.stringify(body, null, 2));
        } else {
            console.log(new Uint8Array(body));
        }
        return body;
    }).then(body => {
        if (target.checker) {
            console.log("=============tests==============")
            let javaScriptCode = "export default function validate(client,response) {" + target.checker + "};";
            import("data:application/javascript;charset=utf-8;base64," + base64.encode(textEncoder.encode(javaScriptCode)))
                .then(module => {
                    module['default'](checkerContext['client'], checkerContext['response'])
                });
        }
    }).catch(error => console.error(error))
}

export async function parseTargets(filePath: string): Promise<HttpTarget[]> {
    const file = await Deno.open(filePath);
    let targets: HttpTarget[] = [];
    let httpTarget = new HttpTarget("", "");
    for await (const l of readLines(file)) {
        const line = l.trimEnd() as string;
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
        } else if (line.startsWith("  ")
            && (line.indexOf("  /") >= 0 || line.indexOf("  ?") >= 0 || line.indexOf("  &") >= 0)
            && httpTarget.headers === undefined) { // long request url into several lines
            httpTarget.url = httpTarget.url + line.trim();
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

function buildHttpClient(httpTarget: HttpTarget): HttpClient {
    return {
        global: {
            clear(varName: string): void {

            }, clearAll(): void {

            }, get(varName: string): string {
                return "";
            }, isEmpty(): boolean {

                return false;
            }, set(varName: string, varValue: string): void {

            }

        },
        test(testName: string, func: Function) {
            console.log(`===========test: ${testName}================`);
            func();
        }, assert(condition: boolean, message?: string): void {
            assertEquals(condition, true, message);
        }, log(text: string): void {
            console.log(text);
        }
    }
}

function buildHttpResponse(res: Response, body: string | object): HttpResponse {
    return {
        body: body,
        contentType: {
            mimeType: "",
            charset: "utf-8"
        },
        headers: {
            valueOf(headerName: string): string | null {
                return res.headers.get(headerName);
            }, valuesOf(headerName: string): string[] {
                let values: string[] = [];
                let value = res.headers.get(headerName);
                if (value) {
                    values.push(value);
                }
                return values;
            }
        },
        status: res.status
    };
}

