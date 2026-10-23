import { chromium, expect } from "@playwright/test";
import { writeFile, mkdir } from "node:fs/promises";
const folder="tasks/archive/proofs/security-pr620-2026-10-23";
await mkdir(folder,{recursive:true});
const browser=await chromium.launch({headless:true});
const context=await browser.newContext({viewport:{width:390,height:844},locale:"en-US",timezoneId:"America/Chicago",reducedMotion:"reduce"});
const page=await context.newPage();
const errors=[];page.on("pageerror",error=>errors.push(error.message));
let flow="onboarding", inviteLink="required", resend="sent", requests=[];
const token="fixture-inbox-token";
await page.route("**/api/auth/**",async route=>{
 const path=new URL(route.request().url()).pathname;
 const body=route.request().postDataJSON(); requests.push({path,body});
 let status=200,result;
 if(path==="/api/auth/discover")result={flow,...(flow==="onboarding"?{inviteLink}:{})};
 else if(path==="/api/auth/invite/resend"){
  if(resend==="malformed")return route.fulfill({status:200,contentType:"text/html",body:"upstream unavailable"});
  result=resend==="unconfigured"?{message:"Invite email is not configured yet. Contact Erik Role for your sign-up link.",inviteEmailConfigured:false}:{message:"If that address has a pending invite, we sent the link.",inviteEmailConfigured:true};
 }else if(path==="/api/auth/register")result={user:{onboardingRequired:true}};
 else {status=401;result={error:"Wrong email or password."};}
 await route.fulfill({status,contentType:"application/json",body:JSON.stringify(result)});
});
await page.route("**/welcome",route=>route.fulfill({contentType:"text/html",body:"<h1>Fixture welcome destination</h1>"}));
async function open(query=""){
 await page.goto("http://127.0.0.1:3131/login?email=student%40example.test"+query);
 await expect(page.locator("#email")).toHaveValue("student@example.test");
 await page.locator("#email").fill("student@example.test");
 await Promise.all([page.waitForResponse(r=>new URL(r.url()).pathname==="/api/auth/discover"),page.getByRole("button",{name:"Continue",exact:true}).click()]);
}
async function width(){expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);}
const passed=[];
await open();await expect(page.getByRole("button",{name:"Email me my invite link",exact:true})).toBeVisible();
await expect(page.locator("#password")).toHaveCount(0);await expect(page.locator("#rememberMe")).toHaveCount(0);await width();passed.push("pending invite without token hides credentials and remember-me");
await page.getByRole("button",{name:"Email me my invite link",exact:true}).click();await expect(page.getByRole("button",{name:"Link sent",exact:true})).toBeDisabled();
expect(requests.filter(x=>x.path==="/api/auth/invite/resend").length).toBe(1);passed.push("resend confirms once and disables repeated submission");
await page.getByRole("button",{name:"Change",exact:true}).click();await page.getByRole("button",{name:"Continue",exact:true}).click();await expect(page.getByRole("button",{name:"Email me my invite link",exact:true})).toBeEnabled();passed.push("Change clears the resend confirmation");
await open("&invite=expired-token");await expect(page.getByRole("button",{name:"Email me my invite link",exact:true})).toBeVisible();passed.push("stale emailed token requests a fresh link");
inviteLink="valid";await open("&invite="+token);await expect(page.locator("#name")).toBeVisible();
await page.locator("#name").fill("Review Student");await page.locator("#password").fill("Review-student-password-82");await page.locator("#confirmPassword").fill("Review-student-password-82");await width();
await page.screenshot({path:folder+"/valid-invite-mobile.png",animations:"disabled"});
await page.getByRole("button",{name:"Create account",exact:true}).click();await expect(page.getByRole("heading",{name:"Fixture welcome destination"})).toBeVisible();
expect(requests.filter(x=>x.path==="/api/auth/discover").at(-1).body.invite).toBe(token);expect(requests.find(x=>x.path==="/api/auth/register").body.inviteToken).toBe(token);passed.push("emailed token forwarded to discovery and registration; successful response navigates to welcome fixture");
flow="password";await open();await page.locator("#password").fill("Wrong-password-82");await page.getByRole("button",{name:"Sign in",exact:true}).click();await expect(page.getByText("Wrong email or password.",{exact:true})).toBeVisible();await expect(page.getByText("Double-check the address above. New here? Open the link in your invite email to set up your account.",{exact:true})).toBeVisible();await width();passed.push("unknown/wrong-password path retains generic error and static recovery hint");
flow="onboarding";inviteLink="required";resend="unconfigured";await open();await page.getByRole("button",{name:"Email me my invite link",exact:true}).click();await expect(page.getByRole("button",{name:"Email unavailable",exact:true})).toBeDisabled();passed.push("missing email configuration never claims the link was sent");
resend="malformed";await open();await page.getByRole("button",{name:"Email me my invite link",exact:true}).click();await expect(page.getByText("Could not confirm the link was sent. Please try again.",{exact:true})).toBeVisible();await expect(page.getByRole("button",{name:"Email me my invite link",exact:true})).toBeEnabled();passed.push("malformed success response remains retryable without false sent confirmation");
expect(errors).toEqual([]);const result={fixtureOnly:true,database:false,emailDelivery:false,viewport:[390,844],passed,pageErrors:errors};await writeFile(folder+"/browser-results.json",JSON.stringify(result,null,2));console.log(JSON.stringify(result));await browser.close();
