/// <reference lib="esnext" />
import {readLines, StringReader} from "https://deno.land/std@0.97.0/io/mod.ts";
import * as fs from "https://deno.land/std@0.97.0/fs/mod.ts";
import {v4} from "https://deno.land/std@0.97.0/uuid/mod.ts";
import {HttpClient, HttpResponse} from "./http-client.ts";
import {assertEquals} from "https://deno.land/std@0.97.0/testing/asserts.ts";
import * as base64 from "https://deno.land/std@0.97.0/encoding/base64.ts";

const textEncoder = new TextEncoder();

const httpClientEnvFile = "http-client.env.json";
const httpClientPrivateEnvFile = "http-client.private.env.json";

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

    replace() {
        if (typeof this.body === "string") {
            if (this.body.startsWith("< ")) { // import content from file
                this.body = Deno.readFileSync(this.body.trim().substr(2));
            }
        }
    }
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
            checkerContext['response'] = buildHttpResponse(res);
        }
        return body;
    }).then(body => {
        console.log("");
        if (target.checker) {
            checkerContext['response'].body = body;
        }
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
    const cleanContent = await getCleanHttpFile(filePath);
    let targets: HttpTarget[] = [];
    let httpTarget = new HttpTarget("", "");
    for await (const l of readLines(new StringReader(cleanContent))) {
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
        } else if (line.indexOf(":") > 0 && httpTarget.body === undefined && httpTarget.checker === undefined) { // http headers
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


/**
 * replace variables with context
 * @param text text content
 * @param context context
 */
function replaceVariables(text: string, context: { [name: string]: string }): string {
    let newText = text;
    while (newText.indexOf("{{") >= 0) {
        let start = newText.indexOf("{{");
        let end = newText.indexOf("}}");
        if (end < start) {
            return newText;
        }
        let name = newText.substring(start + 2, end).trim();
        let value = context[name] ?? "";
        newText = newText.substring(0, start) + value + newText.substring(end + 2);
    }
    return newText;
}

/**
 * get clean http file with variables replaced
 * @param httpFile http file name
 */
async function getCleanHttpFile(httpFile: string): Promise<string> {
    let env = Deno.env.get("HTTP_CLIENT_ENV");
    let context: { [name: string]: any } = {}
    context["$uuid"] = v4.generate();
    context["$timestamp"] = Date.now();
    context["$randomInt"] = Math.floor(Math.random() * 1001);
    // load http-client.env.json
    if (fs.existsSync(httpClientEnvFile)) {
        let fileText = Deno.readTextFileSync(httpClientEnvFile);
        let json: any = JSON.parse(fileText);
        let keys = Object.keys(json);
        if (keys.length > 1) {
            if (env && json[env]) {
                Object.assign(context, json[env]);
            }
        } else if (keys.length == 1 && env === undefined) {
            env = keys[0];
            Object.assign(context, json[env]);
        }
    }
    // load http-client.private.env.json
    if (fs.existsSync(httpClientPrivateEnvFile) && env !== undefined) {
        let fileText = Deno.readTextFileSync(httpClientPrivateEnvFile);
        let json: any = JSON.parse(fileText);
        if (json[env]) {
            Object.assign(context, json[env]);
        }
    }
    console.log("context: ", context);
    const fileContent = await Deno.readTextFile(httpFile);
    return replaceVariables(fileContent, context);
}

function buildHttpClient(httpTarget: HttpTarget): HttpClient {
    return {
        global: {
            clear(varName: string): void {
                localStorage.removeItem(varName);
            }, clearAll(): void {
                localStorage.clear();
            }, get(varName: string): string {
                return localStorage.getItem(varName) ?? "";
            }, isEmpty(): boolean {
                return localStorage.length == 0;
            }, set(varName: string, varValue: string): void {
                localStorage.setItem(varName, varValue)
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

function buildHttpResponse(res: Response): HttpResponse {
    return {
        body: "",
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

