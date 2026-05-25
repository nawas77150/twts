# Changelog

## [1.4.0](https://github.com/james2256/tweetfess/compare/v1.3.0...v1.4.0) (2026-05-25)


### Features

* add safety filter rules (selfHarm/CSAM/solicitation/PII) + UsersDialog pagination with server-side search ([c152a33](https://github.com/james2256/tweetfess/commit/c152a335456a5e6974012f64ed253672ae37e376))
* merge phoneNumbers into pii, move selfHarm/csam/solicitation to admin review ([9994f1c](https://github.com/james2256/tweetfess/commit/9994f1cb336915483ef1d933ce9e8a5fead5df3f))


### Bug Fixes

* blocklist reason input layout ([293a365](https://github.com/james2256/tweetfess/commit/293a365c67c866b81097274f570e7bb116d1a953))
* filter ([47d4f70](https://github.com/james2256/tweetfess/commit/47d4f70ddcc6be4b73aa6db25b4a4c309aff8878))

## [1.3.0](https://github.com/james2256/tweetfess/compare/v1.2.4...v1.3.0) (2026-05-25)


### Features

* custom block message with per-user reasons ([6be3aa4](https://github.com/james2256/tweetfess/commit/6be3aa414e1aa408e2aba531a7120545f335c818))


### Bug Fixes

* pass initialBlockReason through server render path ([f27fa72](https://github.com/james2256/tweetfess/commit/f27fa72ea517965fc7baebdc8a9e06c2a2b8be32))
* replace unsafe Record bracket access with safeGet(); fix dead-code ?? in 403 handler ([f5878f9](https://github.com/james2256/tweetfess/commit/f5878f9e572376cfbdd2252dec476161cb1c4be5))
* use RELEASE_PLEASE_TOKEN instead of GITHUB_TOKEN to trigger deploy-stable ([c6f46a9](https://github.com/james2256/tweetfess/commit/c6f46a9c1aeaabb0b75ca507cce123f86db169e1))

## [1.2.4](https://github.com/james2256/tweetfess/compare/v1.2.3...v1.2.4) (2026-05-23)


### Bug Fixes

* strip trailing punctuation in hashtag dedup to avoid false duplicates ([47acfc0](https://github.com/james2256/tweetfess/commit/47acfc0d47e0380495cc2517dac1e0a13f036ff6))

## [1.2.3](https://github.com/james2256/tweetfess/compare/v1.2.2...v1.2.3) (2026-05-23)


### Bug Fixes

* deduplicate hashtags, remove unused import, fix SAST warning ([7210810](https://github.com/james2256/tweetfess/commit/7210810ecb3d677b1a153375ccd7b5cb8ab69ff8))
* replace async handler with sync void and use retry counter instead of ref ([7d28c1c](https://github.com/james2256/tweetfess/commit/7d28c1cf06cf01ee43191efc5dd7e56bb31252f4))
* resolve SAST non-serializable expressions and floating promise in auth-gate and confession-form ([b39ce0b](https://github.com/james2256/tweetfess/commit/b39ce0bf892e7e1ca0ec7b11ee3ecd9e3a72ac4e))

## [1.2.2](https://github.com/james2256/tweetfess/compare/v1.2.1...v1.2.2) (2026-05-23)


### Bug Fixes

* add loading spinner and toast feedback to auth retry buttons ([e95ec14](https://github.com/james2256/tweetfess/commit/e95ec1493b35917342d6a5369bc56bf514d423b1))
* show blocked screen immediately for blocked users on page load ([889b75f](https://github.com/james2256/tweetfess/commit/889b75f4a6d3ab103576781b90f2c93b50f04c6e))
* toggle ([227a2cc](https://github.com/james2256/tweetfess/commit/227a2cc3cbd5c9af9b48043258bbf30f8e360c0c))

## [1.2.1](https://github.com/james2256/tweetfess/compare/v1.2.0...v1.2.1) (2026-05-23)


### Bug Fixes

* append hashtags on admin approve/retry & remove double scroll in users dialog ([a660805](https://github.com/james2256/tweetfess/commit/a66080512d9a49dc3e24755add81beab1149821d))

## [1.2.0](https://github.com/james2256/tweetfess/compare/v1.1.0...v1.2.0) (2026-05-22)


### Features

* add AdminAuthContext + AdminStatsContext ([3eb52c9](https://github.com/james2256/tweetfess/commit/3eb52c95111bf35c5bd3f4e7714654a1331d6a33))
* add lightweight session endpoint and rename verifyAdmin parameter ([2f836e5](https://github.com/james2256/tweetfess/commit/2f836e5d9469680c70b508035e0e0361e25a4677))
* admin UI for post hashtags setting ([3f2100b](https://github.com/james2256/tweetfess/commit/3f2100b4b99b4a6e4b8c135064ecc1f93f3beeae))
* admin-configurable post hashtags with proportional char limit ([fa1e001](https://github.com/james2256/tweetfess/commit/fa1e001ceb5ecd683d1e3dfed50e5f601bc430cb))
* **admin:** loading/error state consistency — skeleton, shimmer, error retry ([9c97820](https://github.com/james2256/tweetfess/commit/9c9782076a443cc3f33aae3379e2da56e7735aff))
* **admin:** optimistic updates, instant stats sync, per-card loading, stale indicator ([7ae4be0](https://github.com/james2256/tweetfess/commit/7ae4be0fd20a0980eed4a65cba0d2271b4cd536d))
* **home:** server-render page + pre-hydrate auth from cookies ([0c6b747](https://github.com/james2256/tweetfess/commit/0c6b747d992b1bc28943a794e834b1bc95bea8fa))
* namespaced debug logging with timestamps, DB query duration ([09646ee](https://github.com/james2256/tweetfess/commit/09646ee3f6966cae9ea6b81d2cb3a04cb26d6c31))
* proxy auth with HMAC verify, admin SSR shell, settings layout, EncryptionBanner context refactor ([b8ee0fb](https://github.com/james2256/tweetfess/commit/b8ee0fb55e3b8aab8b02f50d6b0524df8f6c9030))
* **public:** live cooldown countdown, auto-poll MyPosts, cooldown-expired refetch ([3299964](https://github.com/james2256/tweetfess/commit/3299964b91ffbdb6a7d48eaefde17181a89d3f83))
* **settings:** split isSaving into isSavingFilter + isSavingRateLimits ([70611f7](https://github.com/james2256/tweetfess/commit/70611f7029610d1010a6950ea933d2802380e80d))
* **ui:** compact dashboard cards, upgrade lucide v1, remove API credits card, update CI actions ([3d41226](https://github.com/james2256/tweetfess/commit/3d412266414b8d7f8a3e9fa71337aae31dcaa0f0))


### Bug Fixes

* 401 toast dedup, status validation, stale closure, reset flags, JSON parse guard ([c5f6a19](https://github.com/james2256/tweetfess/commit/c5f6a19e7d9019b5b0f1ba356a7a0885fcc575e8))
* add [status, createdAt] index, batch circuit-breaker reads, cache filter settings ([13cefbe](https://github.com/james2256/tweetfess/commit/13cefbeef28240209659c1f5f29573e70f311f7f))
* add missing posting.setV2LoginEnabled to useEffect deps (exhaustive-deps) ([8370cbb](https://github.com/james2256/tweetfess/commit/8370cbbf114ae33a9aef152af571d23149b3cb6f))
* add safeAccess helper to resolve SAST Object Injection Sink warnings in users-dialog ([d0bdc69](https://github.com/james2256/tweetfess/commit/d0bdc6927afdfb5dc2f5bafa131549895546867e))
* add timeouts to remaining bare external fetches ([9110337](https://github.com/james2256/tweetfess/commit/9110337b1f16ec8eef1c768049b8f72ea2d5a114))
* add u flag to normalizeForFilter regex ([0ad343f](https://github.com/james2256/tweetfess/commit/0ad343f457a5c7d5cf172f7f1cc2bdf9777c3652))
* **admin:** isolate save payloads + structuredClone all caches ([87c215e](https://github.com/james2256/tweetfess/commit/87c215eb637d7f584edc3c65fdcbe049cc084da8))
* bug fixes and dead code cleanup ([acc5cdf](https://github.com/james2256/tweetfess/commit/acc5cdf8d7fb83a9d8cc59d0b4dcad69ef4a976e))
* circuit-breaker lastFailureAt race + login lockout bypass + remove unused imports ([7b76046](https://github.com/james2256/tweetfess/commit/7b760469010e318e0c39278091b79de4e18ce843))
* credits cold-cache fallback + form field id/name + auth dedup ([74d2054](https://github.com/james2256/tweetfess/commit/74d2054e4787a6d703e8ee36eef6aab91d4ad85e))
* credits error cache guard, refresh bypass, dynamic robots, imperative resetState on logout, lint cleanup ([ab546ec](https://github.com/james2256/tweetfess/commit/ab546ec2fb3f4e888f028578ffc26b88849fe08c))
* **deps:** update dependency lucide-react to ^0.577.0 ([beecf9b](https://github.com/james2256/tweetfess/commit/beecf9be1e009e93ba642ee95bcaa3e5b6279ce8))
* **deps:** update dependency lucide-react to ^0.577.0 ([2ba409d](https://github.com/james2256/tweetfess/commit/2ba409d194fa7dd097ae705375d7526d4732eebc))
* empty-value guard, login spinner, skeleton keys, metadata ([84d66ee](https://github.com/james2256/tweetfess/commit/84d66ee7792238baeea578cf8f53420bb1ef950a))
* filter bypass (combining marks, fullwidth, zero-width), Gemini key exposure, error handling consistency ([23a42db](https://github.com/james2256/tweetfess/commit/23a42dbaafc5f901750125638ef01d796366d837))
* guard empty normalizedMessage dedup, fix postMethod comment, revert u flag ([bee91a7](https://github.com/james2256/tweetfess/commit/bee91a784825f8316315c52d509dd84851d1e035))
* harden safeAccess with Object.keys whitelist validation for SAST compliance ([cbbb9d9](https://github.com/james2256/tweetfess/commit/cbbb9d962bb0e31344ba26d2191a16e8cf62519c))
* icon-btn CSS specificity + admin UX hardening ([a2cdccf](https://github.com/james2256/tweetfess/commit/a2cdccfcc823ea797ceaf60cac38e7116c12803e))
* **lint:** replace 'as any' with readonly string[] widening in status validation ([1b8290c](https://github.com/james2256/tweetfess/commit/1b8290c502631e5576202b5a5a7a939850673c5b))
* patch 9 bugs (auth, filter bypass, timeouts, cache, JSONB) ([d7a12c8](https://github.com/james2256/tweetfess/commit/d7a12c84cb8ea9b664cb883a9896f44ec4d642e6))
* pin release-please-action to SHA, move tryAuth to function body root, suppress false positive hardcoded-password SAST warnings ([a4a6af3](https://github.com/james2256/tweetfess/commit/a4a6af3c70067d60476f29b4bfd5b989f5e1f0cf))
* polling toast spam, data loss guard, rate limit detail, 401 interceptor, toast limit, reject confirmation ([a3c83b4](https://github.com/james2256/tweetfess/commit/a3c83b43d9d371981d17e588fe7f78646ff0e217))
* recover stale postings, wrap confession in form, protect admin API routes ([4e2d62e](https://github.com/james2256/tweetfess/commit/4e2d62e7e04b13f17ec90f4ebc923cb1de99c355))
* remove redundant cancelled check before await in use-submitter-auth ([036f763](https://github.com/james2256/tweetfess/commit/036f76308978f43e547e6ae0a762f3e449664f61))
* remove unused import, deduplicate block/unblock in use-submitters ([c2dd634](https://github.com/james2256/tweetfess/commit/c2dd634b15a0a20b55d91a6af1ddf3e94f33481e))
* repair stats mutation bug and simplify stat accessor functions ([b5a1c1a](https://github.com/james2256/tweetfess/commit/b5a1c1a3e9abc224ab569c015a99602dbda9e5c6))
* resolve SAST issues — object injection sink, non-serializable expressions, unused imports, img element ([4c7b468](https://github.com/james2256/tweetfess/commit/4c7b468fde721fcd58a6622f50068fcf19cf7ff8))
* resolve SAST non-serializable expressions and img element issues across 10 files ([1d0ead3](https://github.com/james2256/tweetfess/commit/1d0ead31ce2c4746c7b6ca77e44f719286731adb))
* **sast:** object injection sinks, unhandled async errors, SSRF, and XSS ([9bb0712](https://github.com/james2256/tweetfess/commit/9bb07123851ccb637581407cf939f32e5cae6781))
* **sast:** replace URL constructor SSRF validation with API prefix whitelist ([205454e](https://github.com/james2256/tweetfess/commit/205454e8fd9834d12cae342012e0f5689c87bc45))
* **sast:** SSRF URL validation, Map for bracket access, Response for HTML, unused imports ([0cb56e1](https://github.com/james2256/tweetfess/commit/0cb56e1a88a91ebc50c9c6d5d73de9214a0ed2d6))
* **sast:** use safeAccess and consolidate const strings into objects ([744960f](https://github.com/james2256/tweetfess/commit/744960fea173e3a06d2e3f2c4a76a9b6229bc546))
* security bypass, race conditions, info leaks, UX bugs ([99a6aa7](https://github.com/james2256/tweetfess/commit/99a6aa7d2fc2f17b98bd5fe68aaa4a49f2f9aeae))
* **security:** SAST findings — object injection sink, unused var, regex combining chars ([5538e08](https://github.com/james2256/tweetfess/commit/5538e08262944d9513a513e6439d4d79eafec5cd))
* sever server-only import chains leaking into client bundle ([5e1d411](https://github.com/james2256/tweetfess/commit/5e1d411a5587607d442e20406780b4f8480c3a64))
* SSRF validation + cache invalidation for filter settings ([4bb6c60](https://github.com/james2256/tweetfess/commit/4bb6c603001e053601e1801c1233d776b1aa9bbe))
* submit guard, actionLoading race, error handling, security ([cace644](https://github.com/james2256/tweetfess/commit/cace644d656201515936114c56b60bea2b695df3))
* tag plaintext encrypt values, add Cache-Control to all autopost responses ([629a0c0](https://github.com/james2256/tweetfess/commit/629a0c03cefe55b61a955e2d9eec8a9cc07483ff))
* use location.assign() instead of location.href to resolve XSS SAST warning ([da85b7a](https://github.com/james2256/tweetfess/commit/da85b7af02cff5e0ff419bdd2945ac1c9cf018fd))
* use Map for SAST compliance in limits route and extract getUpdatedSubmissionOrWarning to deduplicate submission routes ([854ea35](https://github.com/james2256/tweetfess/commit/854ea35f2b4213914075f3fc7c8d049a0b2c6b43))
* use Map instead of Record for editValues/customLimits to resolve SAST Object Injection Sink ([f888863](https://github.com/james2256/tweetfess/commit/f8888633b21693361336fe2876c34d3f9b17a6a2))
* useSubmitters error handling, SSRF proxy validation, credential empty-check ([78ef5d1](https://github.com/james2256/tweetfess/commit/78ef5d1a264211ca3fccccd5d951eeb082d402f8))
* whitelisted users see ∞ caps instead of enforced limits ([813fc94](https://github.com/james2256/tweetfess/commit/813fc94accb46892efa4ef8f6af6a8686758d46e))

## [1.1.0](https://github.com/james2256/tweetfess/compare/v1.0.0...v1.1.0) (2026-05-19)


### Features

* 3-layer posting with V2 toggle + twid required cookie ([2f36cf3](https://github.com/james2256/tweetfess/commit/2f36cf3a5df86b57d875962fa6b204c5f494fc8a))
* add autopost cron endpoint and standardize usernames to lowercase ([e780cf3](https://github.com/james2256/tweetfess/commit/e780cf34c4ac6f1b48c78a9f1b718dc7008fa637))
* add censored status for filtered submissions ([397ba79](https://github.com/james2256/tweetfess/commit/397ba798cea90b46c8cd06cf48c7d1512b0a3b44))
* add failure window to circuit breaker, fix stale failure counting ([f2bef5d](https://github.com/james2256/tweetfess/commit/f2bef5d62ccbb1ccb6397cfb0e74223c1229b2b4))
* add global post daily cap and remove autoPostCooldown max limit ([cbcb6d5](https://github.com/james2256/tweetfess/commit/cbcb6d5d3a97595135cb5664cae69c7e2c05ed05))
* auto-save Gemini toggle on click ([3ab34fe](https://github.com/james2256/tweetfess/commit/3ab34feffff62a06facf1783ea80fe1ea258075b))
* configurable gemini model via admin UI ([a21483f](https://github.com/james2256/tweetfess/commit/a21483fbd5476b9cdf317a761e666db263d22340))
* **security:** token expiry + brute-force lockout + security headers + XSS sanitization ([03cff95](https://github.com/james2256/tweetfess/commit/03cff956ea602d4d95f84da05cfb738e2b53cd85))


### Bug Fixes

* add censored/censoredReason to submitMessage return type ([4a5d8db](https://github.com/james2256/tweetfess/commit/4a5d8db2193b02f840ed45fb048f85242d4321ee))
* add daily reset to pending cap and compact stats grid on mobile ([24d4c89](https://github.com/james2256/tweetfess/commit/24d4c89d6831608e1907a3162f4a7721d642ebc4))
* add default value to normalizedMessage column for existing rows ([31115e6](https://github.com/james2256/tweetfess/commit/31115e60bbaf70d8e8f13b273b942ca66bee3578))
* add error toasts for circuit breaker reset and logout failures ([e34c3e0](https://github.com/james2256/tweetfess/commit/e34c3e07400d7a76d65eec62c78551c0a92de697))
* add security headers to OAuth callback, move Gemini key to header, tighten isEncrypted heuristic ([8123c8a](https://github.com/james2256/tweetfess/commit/8123c8a78cba320004bb3c4a585c286c6197be90))
* add void prefix to floating promises ([1c4b924](https://github.com/james2256/tweetfess/commit/1c4b92408a79407c9b972e621bb100ea5d891d2e))
* add void to floating promises and brace inner void callbacks ([af4a7a1](https://github.com/james2256/tweetfess/commit/af4a7a14b2228d90853542730d9b521a36c99483))
* auto-mode fallback on early returns, circuit breaker &gt;= threshold, whitelist/blocklist race condition + Users tab ([35e01de](https://github.com/james2256/tweetfess/commit/35e01de3bb4351c951e9ba41e2a36f7fe9dc9e66))
* auto-recover stuck posting status after 2 min stale threshold ([a13422a](https://github.com/james2256/tweetfess/commit/a13422a1c41a72a37287852e173d61259c2218f9))
* block anon users from posting + stable anon identity ([89d5809](https://github.com/james2256/tweetfess/commit/89d58098a695edb30321eb04678c665ce560ca79))
* capture and return actual twitterapi.io error instead of generic message ([e4d18a0](https://github.com/james2256/tweetfess/commit/e4d18a0c82430c254c95db1944d7af38b14db06b))
* **ci:** add bun setup for Vercel build ([fea3626](https://github.com/james2256/tweetfess/commit/fea36260f996394b5159a824e14fa036d4bd268e))
* **ci:** let Vercel build on their servers for Neon secrets access ([97e6593](https://github.com/james2256/tweetfess/commit/97e6593a911ef36addba2805ff505b0291f08b55))
* Circuit breaker rejects instead of queuing ([17ffbb5](https://github.com/james2256/tweetfess/commit/17ffbb5a18756f81b549999b92b60cffd31c51ae))
* **ci:** use repository_dispatch to trigger deploy-stable from release-please ([d80d69d](https://github.com/james2256/tweetfess/commit/d80d69d90df1b1ba777110f95806169650959a5f))
* double-post race, circuit breaker, timing attack, and UX bugs ([8f95c2b](https://github.com/james2256/tweetfess/commit/8f95c2b3e5750630352b5ae6612ba9de2049092b))
* **filter-settings:** add per-item error handling in upsertRateLimits() ([8218926](https://github.com/james2256/tweetfess/commit/82189268489d1b81dd45d453cbff2f9b2553cd3a))
* **filter:** harden normalizeText against unicode bypass — homoglyphs, combining marks, invisible chars ([bcb4671](https://github.com/james2256/tweetfess/commit/bcb46719bda07d82643b0d9c4101defbe5770d07))
* handle optional censoredReason in toast lookup ([9032cda](https://github.com/james2256/tweetfess/commit/9032cda32730939150799bea58feb456c5d6fdee))
* **hooks:** unify actionLoading key to prevent concurrent actions on same card ([1b2ae7b](https://github.com/james2256/tweetfess/commit/1b2ae7b65641f04c7319ff3343b40caf827869a6))
* import Node.js crypto module for crypto.randomInt() in retry jitter ([97480ae](https://github.com/james2256/tweetfess/commit/97480ae6d372b084373c55748014c66609a734e3))
* non-blocking API credits fetch on admin dashboard cold start ([1dae540](https://github.com/james2256/tweetfess/commit/1dae54044885a0ee0c8648cb31c2ac48c63adbf2))
* pending count overwrite, stale blocklist, optimistic revert, premature OAuth toast, useToast race, server-side search, silent my-posts error ([07c58eb](https://github.com/james2256/tweetfess/commit/07c58eb00a0d9d32c963a323a66c17510987eaa6))
* posting lock leak on DB error, case-sensitive duplicate bypass, URL filter zero-width bypass ([5b73187](https://github.com/james2256/tweetfess/commit/5b73187c95089c9c12d1707518a2195e86d9cc10))
* **posting:** catch post exceptions, extract shared helpers, deduplicate decrypt ([3dfc508](https://github.com/james2256/tweetfess/commit/3dfc508bf9de18b875588a41a73144d9116ac68d))
* prevent delete during posting, clamp rate limit inputs, fix edge cases ([633f977](https://github.com/james2256/tweetfess/commit/633f97733d5a37b8e9a93db7666525a026a05185))
* race conditions in stale-posting, delete, reject + cooldown re-check + circuit breaker + cookie API validation ([f004a62](https://github.com/james2256/tweetfess/commit/f004a62442d31d3d16cbf9223636efe24a3366ad))
* redundant optional chaining after type cast and V2 toggle a11y label ([70b8c9f](https://github.com/james2256/tweetfess/commit/70b8c9f274f94232249319a5c1a829b1a2206d0e))
* remove unnecessary decrypt for plaintext gemini_model setting ([3dd8aaa](https://github.com/james2256/tweetfess/commit/3dd8aaa156ba2a3ce06a5c338d4c0aed26d883ca))
* remove unused apiClient import, wrap handlers with useCallback in UserListCard ([44d80a0](https://github.com/james2256/tweetfess/commit/44d80a09b48ca7fb21f03b4cfce5cf2a99771810))
* remove unused db import from twitter-api-credits ([a9a7e77](https://github.com/james2256/tweetfess/commit/a9a7e777109565500a25c99a951e084271286e6e))
* remove unused directMethod param and convert arrow to function declaration ([a625ebf](https://github.com/james2256/tweetfess/commit/a625ebf6c2ad21b6a9fe181a12cfaa2a02a9f098))
* remove unused imports, void floating promises, add button type attrs, complete useEffect deps ([dcf55b4](https://github.com/james2256/tweetfess/commit/dcf55b4f924c518b51d13c7f9e9bb55000212630))
* replace control char regex with \P{ASCII} to resolve Vercel HIGH warning ([4ab1ab6](https://github.com/james2256/tweetfess/commit/4ab1ab62ec427eaaceffc551b5ab9504560ca639))
* replace Math.random() with crypto.randomInt() in retry jitter ([e3e826d](https://github.com/james2256/tweetfess/commit/e3e826d74806800ef07e17c46187fc6a483367bc))
* resolve 18 bug-scan issues + footer mobile responsive ([b40337a](https://github.com/james2256/tweetfess/commit/b40337a9dc76093871e06ceeef7ace31896992c6))
* resolve ambiguous column reference value in raw SQL queries ([d52f79c](https://github.com/james2256/tweetfess/commit/d52f79ca257ea8517e266267beeed7e79f4cdce9))
* resolve noLabelWithoutControl and noArrayIndexKey lint issues ([37007b2](https://github.com/james2256/tweetfess/commit/37007b2ee954becf18ded4069722265b71454869))
* responsive admin settings on mobile, correct pending cap label (not daily) ([58f07c4](https://github.com/james2256/tweetfess/commit/58f07c429904a706a75b53db4aa2d88a7fb1d656))
* security hardening and robustness fixes (47 files) ([40bcb55](https://github.com/james2256/tweetfess/commit/40bcb55c9f5d22662e1f23ef65440714f9aeb7b9))
* silent refresh after admin actions and variable shadowing ([7707c28](https://github.com/james2256/tweetfess/commit/7707c2843bf451efafda78d125b4b631cc899b17))
* stop HTML-encoding messages before posting to X and enforce 30-min login lockout ([10a7a85](https://github.com/james2256/tweetfess/commit/10a7a85de2dc87b94af328f37da486529b507680))
* store OAuth state in DB to fix mobile login with X app ([6aee67a](https://github.com/james2256/tweetfess/commit/6aee67a62716e283c6a7b35a9611af869b8ffe3d))
* type setRateLimits as React.Dispatch for functional setState ([1082e55](https://github.com/james2256/tweetfess/commit/1082e551468a02b7d7c8a89d05ed4fdad4305305))
* use Map instead of Record to resolve SAST Generic Object Injection Sink warning ([66ad5f6](https://github.com/james2256/tweetfess/commit/66ad5f6cb8bd3e52c9aa8997c5686c38b3e5617d))
* void remaining floating promises across hooks and admin pages ([2ef5dc4](https://github.com/james2256/tweetfess/commit/2ef5dc4d0328e4c32d54b7fbcf627e52e76f09d3))
* wrap void arrow fns, add button types, remove redundant role, replace non-null assertion ([ecb3438](https://github.com/james2256/tweetfess/commit/ecb34388c769c6e311515ed0a659894f760f2f49))
