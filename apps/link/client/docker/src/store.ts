import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ServerConfig } from "./config.ts";
import type { ReconnectSettings } from "./reconnect.ts";
export type Tunnel = {
 id:string; name:string; type:"http"|"https"|"tcp"|"udp"; localIP:string; localPort:number;
 subdomain?:string; remotePort?:number; customDomains?:string[]; httpUser?:string; httpPassword?:string;
 hostHeaderRewrite?:string; enabled:boolean; status?:string; runtimeStatus?:string; remoteAddr?:string;
 errorMessage?:string; createdAt?:string; updatedAt?:string;
};
/** 临时文件序号：并发写同一存储文件时保证 tmp 名不冲突，避免两路写入交叉损坏内容 */
let tmpSeq = 0;
export class DataStore { readonly dir:string; constructor(dir:string) { this.dir=dir } private p(n:string){return join(this.dir,n)}
 async init(){await mkdir(this.dir,{recursive:true})} async read<T>(name:string,fallback:T):Promise<T>{try{return JSON.parse(await readFile(this.p(name),"utf8"))}catch{return fallback}}
 async write(name:string,value:unknown){const tmp=this.p(`.${name}.${process.pid}.${tmpSeq++}.tmp`);await writeFile(tmp,JSON.stringify(value,null,2),{mode:0o600});await rename(tmp,this.p(name))}
 config(){return this.read<ServerConfig|null>("config.json",null)} saveConfig(v:ServerConfig){return this.write("config.json",v)} tunnels(){return this.read<Tunnel[]>("tunnels.json",[])} saveTunnels(v:Tunnel[]){return this.write("tunnels.json",v)}
  /** 自动重连偏好独立于服务器配置存储，允许在未配置服务器前先保存。 */
  reconnect(){return this.read<ReconnectSettings|null>("reconnect.json",null)} saveReconnect(v:ReconnectSettings){return this.write("reconnect.json",v)}
}
