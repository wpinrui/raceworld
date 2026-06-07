RaceWorld is a simulation engine in which the player can watch how an alternative reality F1 world unfolds and are given god tools (essentially freely editable fields) to affect the simulation and see how it would play out differently.

# Screens
There are five main screens in RaceWorld. 
1. Setup screen/Drivers screen: allows the player to set up the teams and drivers in the simulation. The rest of the driver market is procedurally generated. The player can CRUD the driver market from this screen at any time after setup. The player can pre-populate the real world 2026 F1 teams and drivers, as well as their attributes, to use as a base to edit for their perfect setup. The player can also import this from locally, so that if they want other seasons, they can do so.
2. Standings screen: displays driver and constructor standings, including colour-coded complete race results for the season, and a selector so that players can view past seasons. It can also be toggled to show career results for a particular driver, or results for a particular constructor. No real-world historical data; only game-world data. For current drivers and teams, the player can also edit driver and team attributes from here.
3. Home Screen: just a bunch of convenient views for the player. The player can see the upcoming races on a banner bar that shows the last four and next four races, pundits predictions for the races, media driver rankings and car rankings, a compact standings view, and a compact news headlines view
4. Newsroom: This is where the player can see the latest headlines, which could include season preview, race preview, race review, season report, partial season report. Not all need to be regenerated every race, like the season preview is once per season, season report is once per season, partial season report could happen 2 or 3 times a season. Race review should happen every race. Race preview should happen only when there are championship implications, like someone could clinch the championship next round, or a championship decider. Importantly, there is a search bar here, where the player can "search" for a topic of their choice (but really the news is being generated upon search, not pre-existing). The player cannot fool the LLM into spouting fake news: everything the player "searches" for can be assumed true unless it directly contradicts the stats provided by the stats engine.
5. Race simulation screen. On this screen, players can see the live race data (lap number, race order, gaps, stint length, current tyre) and can order a driver of their choice to pit, and has god mode tools to adjust the tyre wear of a car, force a retirement or modify a driver's form. Note that physics realism still applies; the player cannot magically heal tyres or unretire a car. There should also be a commentary view (no LLM support here) that gives template strings when cars pit, a car has been closing a gap over the past 3 laps, a car makes an overtake, the weather changes, or a car wins/comes second/comes third/all cars have crossed the finish line. There is a duration of some seconds after each lap simulates. This duration can be paused so the player can take action (pause using space bar, then resume by pressing space again). Pressing 1, 2, 3 or 4 on the keyboard or the UI can set the speeds. Speed 1: 5s wait after each lap. Speed 2: 2s wait after each lap. Speed 3: 0.5s wait after each lap. Speed 4: sim to end with no delay, but with a confirmation that the race will be simmed to the end.

# Newsroom
The newsroom feature, whether it is the routinely generated news or the player demand news, should ground its facts based on the stats engine. As such, the LLM is actually given tools (API calls) to query the stats database, and is given guidance on how to search up relevant info, including what info is available.

## Season-long narrative (#88, #92)
The newsroom is built around a season *arc*, not point-in-time snapshots. A single season-analysis pass derives each season's story from the data: a media-style **expectation** for every driver and car (driver = last season's media score, falling back to pace + narrative for newcomers; car = last season's constructors' finish, with newcomers projected to the back and a save's first season falling back to raw car pace), plus the round-by-round **championship-gap trajectory** and **tier** segmentation. The expectation is the media's *fallible* preseason view, deliberately distinct from true pace — the gap between projection and what actually happens is the story engine. The car dominates the expected order; a driver shifts it by a bounded ~2 grid places, never a full tier.

This drives four grounded pieces (every figure an in-game aggregate stat; texture is limited to details the sim does not model, so it can never be contradicted):
- **Season preview** — introduces the protagonists across tiers (title favourites, dark horses, best-of-the-rest, rookies, veterans, new teams), always crediting the reigning champion's stature and naming every new entry.
- **Championship arc** — sparse standalone pieces firing only at real inflections (a lead eroding or extending, a decider, a lead change), distinguishing a comeback earned on merit from one handed over by the leader's retirements.
- **Race-report coda** — each race report closes on the *running* title narrative when the gap is swinging, not just the static current gap.
- **Season review** — pays off the preview: how the title was won (wire-to-wire / comeback / decider / clear), who beat or missed their projection, and the best of the rest.

Quality over quantity (#92): low-signal producers — the transfer rumour mill, the point-in-time title-fight and title-scenario pieces, and the generic mid-season feature — are pruned in favour of these higher-signal, arc-aware pieces. The factual clinch/lead-change announcement stays. Article copy is authored to the project's hand-written newsroom voice.

# During the season
A few mechanics interact together to make the season dynamic.

## Car performance
At the start of the season, the car paces will be as follows:
1. 75
2. 70
3. 65
4. 60
... and so on.

## Development cycle
Every team has a development in progress, and such developments can take 3 to 6 races to be delivered onto both cars. The choice of development cycle is per upgrade, so teams can have a different development cycle for each upgrade they deliver. The counter starts in Australia and ends at the last race (no matter whether an upgrade happens to be delivered in the last race or not). Each upgrade improves the car to some degree, depending on the team's funding tier and RNG, and choosing a shorter development cycle provides a larger penalty, for example the expected amount of upgrade given by 3 cycles of 6 races is larger than 6 cycles of 3 races. This is to prevent shortest cycles from being optimal. However, the choice of development cycle by all teams is completely random. The player cannot influence this in anyway, however the player can view the randomised upgrade impact of upgrades in progress of any of the teams and edit them (before the upgrade gets applied).

The expected upgrade amount of any upgrade for a 3 race development cycle is +3 to the car pace, however it is a normal distribution with median at +3 and lower quartile +1.5 and upper quartile +4.5. This should be improved slightly more than proportionally for a longer development cycle, perhaps \*1.05^(n-3) where n is the number of races in the cycle. There is also a 5% chance of an upgrade failing (which the player can also see and override if they wish), in which case absolutely no benefit is given at the end of the development cycle.

## End-of-season reshuffle
At the end of each season, all teams will be numbered by their car pace (which is different from constructors standings!) with the fastest team being 1, second fastest being 2 and so on. Each constructor will receive an end-of-season modifier, randomised between -1.5 and +3, note that there is no decimal limit here, it is just a random floating point. Then, the teams will be ranked based on this new total (smallest is best), and the car stats will be distributed based on the new ordering. Note that the relative magnitude is not important; only order matters. For the new season, the car paces will still be reset to 75, 70, 65 and so on.

## Funding tier
Funding tier is tracked by the relative performance of the teams in the past five years of the championship by average constructors' championship position. Teams are ranked best-to-worst lexicographically: first by how many seasons of history they have (a team with a fuller record always ranks above one with a thinner record — four years above three, and so on), then, within the same number of seasons, by the better average constructors' position. Remaining ties — including brand-new teams that share an equal (or zero) history — are broken by current car pace. (For the purposes of the first few seasons of the game with no data, every team is tied on zero history, so this collapses to ranking purely by pace: the best-paced team is treated as having won, the second-best as second, and so on.) Note that the number of teams on the grid can change, but Tier 1 always houses 3 teams, Tier 4 always houses 3 teams, and Tiers 2 and 3 house an equal number of remaining teams.

Tier 1 teams receive no penalty to their upgrades. Tier 2 teams will receive a 0.1 per race penalty. Tier 3 teams will receive a 0.15 per race penalty. Tier 4 teams will receive a 0.2 per race penalty. For instance, if a tier 3 team has a 4-race development cycle upgrade that randomised to a +3.7, then they will receive a penalty of 0.15\*4 = 0.6 -> their upgrade becomes a +3.1 upgrade. If the upgrade has a smaller value than the penalty or fails, then the result is clamped to 0 (no negative development should occur.)

## Driver progression curve
Each driver's age is tracked, along with their peak potential and prime end. The period before a driver reaches their peak is when they will develop at a fast rate (slowing down as they age but continuing to be positive until their potential is reached). At their prime end age, whether or not they have reached their potential, they will start to decline, with the decline accelerating as they age further past their prime end — the per-race decline median is `0.04 × (1 + (age − prime_end) × decline_rate)`, where `decline_rate` defaults to 1 (the standard accelerating curve) but can be set lower per driver so a long-lived veteran (e.g. Alonso, Räikkönen) tapers gracefully toward a near-linear decline instead of cliffing at a late prime end. Different drivers have different potentials, prime end ages, and decline rates. At setup, a pool of free-agent drivers is generated; thereafter, new drivers are generated each season only as needed to fill any seats left vacant after the free-agent market has run. These generated drivers cannot immediately be the top drivers, but some can have the potential to do so.

The progression happens after each race. Generation happens after each season. After each season, drivers who have not been in F1 for five years are removed from the driver market. Drivers who have driven in F1 who are retired will have their history archived.

Progression before peak is also RNG: take 15 * years till prime end to calculate a rough number of races to reach potential, then calculate overall (detailed below) and take gap between current overall and potential, then divide that gap by number of races to potential. This value will act as the lower quartile on the normal curve, this value * 1.5 will act as the median on the normal curve, and we will randomly calculate the actual improvement (the base per-race gain).

Per-attribute develop & decline rates: that base gain (developing) and the per-race drop (declining) are not applied uniformly — each attribute scales the base by its own multiplier, so a driver's profile shifts as they grow and age. The ordering is the spec; the magnitudes are tunable, and are shared by the live engine and the historical-grid projection so composed grids match live development.

| attribute | develop | decline |
|---|---|---|
| Pace | 1.3 | 1.2 |
| Consistency | 1.0 | 1.0 |
| Smoothness | 1.0 | 0.6 |
| Overtaking | 0.8 | 0.8 |
| Wet weather | 0.7 | 0.6 |

Pace grows and fades fastest; consistency builds slowly and fades relatively quickly; overtaking barely moves either way; smoothness and wet weather build slowly and are only slowly lost. A small per-stat noise on top keeps growth from being perfectly proportional.

Composed-driver entry re-balancing: because the slow-developing attributes barely move over a career, a historical driver's authored entry ratings are re-balanced when their grid is composed so they reach a sensible, balanced prime rather than a pace-skewed one — the fast-developing stats (pace) start further below their peak with room to grow, while the slow ones (wet weather, smoothness) start nearer their peak. The shift spreads the driver's development headroom (peak minus current overall) across the attributes by their develop rate, `adj = headroom * (1 - develop_rate / W)` where `W` is the overall-weighted mean develop rate; it is overall-neutral at entry (it redistributes, never inflates the starting overall). Drivers entering already past their prime are not re-balanced (they only decline).

Season form: on top of the smooth career projection, each driver on the grid gets a once-per-season form offset added to ALL of their ratings, modelling up-and-down years / non-linear progression. It is `Normal(0, ~2)` (about +/-4 at the tails), clamped to +/-10, rolled once at the start of each season and held all year. Only seated drivers get a form — a free agent hasn't raced, so there is no on-track wobble to model; their form is 0 until they take a seat (rolled at that rollover). Crucially, the smoothly-developing ratings are the hidden, internal TRUE values; the ratings the player sees AND the values the race sim uses are those plus the season-form offset (clamped 0-100). So a driver can visibly over- or under-perform their underlying trajectory for a season without that wobble compounding into their development.

Note that drivers have 5 stats: pace, wet-weather pace, overtaking, smoothness and consistency. All of them are out of 100. The overall stat (just for user-friendliness) is calculated by taking 0.415\*pace + 0.26\*consistency + 0.1\*overtaking + 0.015\*wet weather pace + 0.21\*smoothness. These weights are empirically calibrated (each ∝ the attribute's measured marginal effect on race results, with the car equalised and technical DNFs removed, one attribute varied at a time); pace and wet-weather pace split the measured speed impact (0.43) by weather exposure (effective wet fraction ≈ 0.027, measured from the live weather model; the split sits a touch above it). This is just a cosmetic overall that the player can use to sort, however it is used (on the internal true ratings) to see if the driver has hit his potential (which means no further improvement can happen, and the driver can only plateau until prime end)

# Simulation engine
For a given lap, the simulation works like this:
A car with 75 pace will take exactly 100 seconds.
This is modified by driver pace, where 75 means no effect, every +5 driver pace maps to a 0.1 second bonus, every -5 maps to a 0.1 second penalty, varied linearly.
Tyre wear: every 4% of tyre wear adds 0.1 to the laptime, varied linearly (worn tyres cost real pace, so fresh rubber and the undercut matter). If tyre condition hits 0%, a 5s per lap penalty is applied.
Weather: every 5% of moisture adds 1s to the laptime, varied linearly. If tyres are outside their moisture window, an additional 30s per lap penalty is applied. For every step the tyres are wrong, an additional 15s per lap penalty is applied: STEPS are dry, intermediate, wet. In completely dry conditions, having wet tyres has an additional 15s penalty compared to intermediate tyres, as it is a further step out of range. Same applies to dry tyres in completely wet conditions compared to intermediate tyres.
Wet-weather ability: the driver's pace and the wet weather ability will be summed up linearly, such that percentage moisture * wet weather + (1 - percentage moisture) * pace will be used as the final pace value.
Fuel load: every 1 lap of fuel corresponds to 0.05 seconds.
Tyre delta: these are the ANCHORS — soft 0, medium +0.7, hard +1.5, intermediate +2.5, wet +4.0 s/lap. Each race the deltas are randomised ~Normal(anchor, σ) and clamped, kept in order so a softer tyre is always at least as fast (soft≤medium≤hard, and intermediate≤wet) but the dry trio and the wet pair are independent chains. Soft stays the 0 reference. Teams don't know the race's deltas and must learn them by running (see Pit strategy).
Form modifier: a driver's form can range between 0 and 10. This form lasts the entire race weekend (including qualifying). At 5, there is no bonus or penalty. Every +1 or -1 will add to the pace calculation directly. Form is randomised pre-race as a normal distribution, and the player can view this pre-race and edit the form. The roll's MEAN is set by the driver's confidence/morale (a 0-10 rating): mean = 2 + 0.6 * confidence (confidence 0 -> mean 2, 5 -> 5, 10 -> 8), drawn as Normal(mean, 1.8) clamped to [0, 10] — so confident drivers tend to roll higher form. Confidence starts at 5, persists across seasons, and updates after every race by whether the driver over- or under-performed their teammate across qualifying + race; a signed streak counter amplifies repeated swings.
Car form: each team has a per-race randomised value that affects both drivers equally, since it affects the car pace, modelling the car simply having a good or bad weekend. It is purely per-race random (not track-specific affinity). It is a normal distribution centred on 0 with a standard deviation of about 5.19, chosen so its quartiles sit at +/-3.5, and the value adds directly to the car's pace calculation. At 0 there is no bonus or penalty. It is re-rolled each race, identical for both of the team's cars, and clamped to +/-25 as a safety bound on the otherwise-unbounded tail.
A per circuit modifier will add a flat X seconds to the final time, where X can be positive or negative or zero. This allows laptimes to look different across different circuits. It serves a purely cosmetic function and does not affect any relative times.
During the race, the gap to car ahead affects the lap time calculation. If the gap to car ahead is between 1s and 2s, the car behind cannot overtake the car in front unless the car behind is more than 2*x seconds faster that lap, where x is the gap before the start of the lap (and is thus clamped to a laptime that causes that car to be 0.5 seconds + some random noise between 0 and 0.5 seconds behind that car). 
If the gap to the car ahead is between 0 and 1s, and the calculated lap time is faster than the car ahead, it is a contested overtake. First a collision roll (issue #60), driven purely by BOTH drivers' consistency: with f(c) = 2e-6 * (100 - c)^2, the crash chance is f(attacker) + f(defender) - f(attacker)*f(defender) (calibrated to ~1 / 0.5 / 0.1 overtake crash-outs per 24-race season at consistency 65 / 75 / 90). On a crash the attacker, the defender, or both retire (collision-damage), in equal thirds. Otherwise the overtaking stat decides: ((1 - gap in s) + (overtaking stat/2))/2 is the probability of the overtake. If it happens, the position swaps and no penalty is applied to either car. If it fails, the attacker's laptime is clamped so the gap stays a 0-0.5s noise behind.
Consistency noise (issue #59): the per-lap random modifier is a slow-down scaled by the driver's consistency rating (the fifth driver stat, 0-100) — uniform over [0s, 1.2 - 0.01 * consistency], i.e. consistency 90 -> [0, 0.30s] (the old flat noise), 75 -> [0, 0.45s], 65 -> [0, 0.55s]. It is always a penalty, so low consistency is systematically slower, not just noisier.

Pit strategy (imperfect information). A perfect-information optimiser exists as a benchmark (the god-mode "Perfect strategy" panel, run on the race's TRUE tyre data). The racing AI instead plans on a per-team BELIEF that starts as an educated guess and sharpens as its cars run. Several things are hidden from the pit wall:
- The per-race truth (pace deltas + base life, both randomised each race) is unknown — priors are only roughly right and must be learned by running each compound.
- Each individual tyre SET also gets its own hidden life modifier when fitted (±15%, see Tyres data). So even a well-learned average never tells the team whether THIS set is a good one or a duff one — the cliff stays a gamble.
- Live tyre CONDITION is read only in coarse 25-point buckets (0-25, 25-50, 50-75, 75-100), so the team can't read exact wear. It INFERS each compound's wear rate from how the bucketed condition has fallen (measured from a fresh 100), sharpening with laps. Both garages feed ONE pooled belief, each read normalised by that driver's own (known) smoothness to recover the driver-independent base rate, then re-applied per driver. Guess quality is flat across teams — just randomness.

From that belief the team PROJECTS its current condition (100 − believed wear rate × laps on the tyre) — a smooth, stint-anchored guess of where the tyre is, clamped to the bucket it can actually see — and aims to box at roughly 10-15% condition. Because the projection falls in step with the laps, the target lap doesn't recede; because the real wear is noisy and the set modifier is hidden, teams are regularly caught out (pitting early on a good set, or grazing the cliff on a bad one).

The plan is re-solved every lap (so it adapts to weather and learned wear), searches all five compounds, and prices in the projected moisture penalty from the team's FALLIBLE forecast — so it pits proactively for inters/wets at the crossover and can be wrong-footed by phantom/unforeseen rain. A 0-stop is only chosen if the current tyre would actually reach the flag above the cliff; a forced or late stop fits the fastest compound that suits the laps remaining (softs for a short sprint).

Which exact lap it boxes:
- Forced: on a badly wrong tyre for the real conditions (e.g. slicks in a downpour — it fits what suits NOW), or the real tyre about to fall off the cliff.
- Voluntary stops PREFER clear air on rejoin (projected by slotting the car's race time + the pit loss back into the field — no point fitting fresh tyres to sit in dirty air), but it's a preference, not a veto: with no clean slot it still boxes near the target rather than ride to the cliff. An undercut chance (a beatable car directly ahead on tyres no fresher) lets it pit a little early. Overcut is not modelled (no tyre warmup/temperatures).

Cars are fuelled identically, and exactly one lap of fuel burns off per lap, so this is purely cosmetic to make lap times come down.

Tyres data:
SOFT: 100% can last 20 + [-5, 5] percent of race distance. Moisture window is 0 to 25%.
MEDIUM: 100% can last 30 + [-5, +10] percent of race distance. Moisture window is 0 to 15%.
HARD: 100% can last 45 + [-5, +10] percent of race distance. Moisture window is 0 to 15%.
INTERMEDIATE: 100% can last 30 + [-5, +10] percent of race distance. Moisture window is 10% to 45%.
WET: 100%  can last 45 + [-5, +10] percent of race distance. Moisture window is 35% to 80%.
A smoothness of 100 can make the tyres last 1.5x as long as the base. A smoothness of 0 can only make the tyres last 0.5x as long as the base. A smoothness of 50 has no bonus or penalty.
The life figures above are per-race ANCHORS: at lights-out each compound's base life is rolled once (Normal around the figure, clamped) and shared by the whole grid (the day's track), then smoothness is applied per driver. On top of that, every individual SET gets its own modifier when fitted (Normal ~±15%, clamped 0.8–1.2x) — a good or duff set — which the team can't see, so the exact cliff lap is a gamble. Actual per-lap wear is then jittered ±30% around the set's baseline. (Intermediate life tracks mediums and wet life tracks hards, which is why the pace deltas order the dry trio and the wet pair as separate chains.)

Weather data:
Pre-race, two wetness curves (moisture %, 0-100, sampled at the START of each lap) are generated: the TRUE curve, which drives the sim, and a FORECAST curve, a deliberately-imperfect prediction used only by the raceday UI.

True weather: ~17.5% of races see rain (sitting between "races with meaningful wet running", ~15%, and "races touched by any rain", ~20%). When a race rains, one of four archetypes is chosen, each with randomised onset, intensity and duration plus a small per-point wobble so no curve is memorisable:
- Passing shower (~45%): dry, a shower rises and fades, dry again.
- Building rain (~25%): starts dry, builds toward the end.
- Drying track (~22%): starts wet, dries out.
- Sustained wet (~8%, rare): wet throughout, with variation.

Forecast: the curve the raceday graph shows. It is the true curve with its onset shifted (start-lap error), its wet window stretched (end-lap error) and its intensity mis-scaled (how-hard error), so the long-range forecast can be well off. The live view blends the forecast toward the truth as each lap nears: displayed error fades as e^(-lead/8), so the forecast is trustworthy within ~8 laps and reads the truth at the current lap. Two rarer binary misses also occur: phantom rain (~10% of dry races forecast rain that never lands) and unforeseen rain (~4% of wet races arrive with no forecast warning). Measured forecast error on wet laps grows from ~2/100 a couple of laps out to ~19/100 at long range. A god-mode toggle on the graph reveals the true future.

The engine always runs on the TRUE curve (the forecast never affects results). Pit strategy is weather-aware (see Pit stop below): it plans on the projected moisture from the team's fallible forecast and pits proactively for inters/wets at the crossover. The qualifying weather model below is still a dry stub.

Wet-weather rating weight: overall() splits the speed impact (0.43) between pace and wet-weather pace by the effective wet fraction. Measured from the live model (17.3% rain, ~0.156 mean moisture in a wet race) this is ~0.027, so the split is pace 0.415 / wet-weather pace 0.015 (a touch above the raw fraction). Re-derive with `npm run wet:measure` if the rain rate or archetype mix changes.

Weather in the newsroom: a finished race carries a weather summary, computed at the flag from the true curve, the fallible forecast and the field's lap times, then persisted with the race so archived seasons read identically. Race reports use it. A wet race gains a headline conditions modifier (matched to peak intensity and the day's shape, e.g. storm-hit / greasy / damp-to-dry) and one short body line, varied by archetype, naming the driver who handled the wet best. That "wet master" is RELATIVE: the biggest pace step-up versus the per-lap field median between a driver's dry and wet running (falling back to best outright wet pace when the race ran wet end to end), so it is often a midfielder rather than the winner, and the line credits only wet pace and car control, never a position or gap. Dry races mention the weather only occasionally (~1 in 5): a grounded line when the forecast had threatened phantom rain that never came, otherwise plausible heat or tyre-wear colour, never a bare "it was dry".

Pit stop:
The time lost for a tyre change is era-dependent (issue #101). A single year-driven source, pitLaneLoss(year) in sim/pit-loss.ts (mirroring perRaceTechnicalDNF), feeds BOTH the runtime penalty and the strategy planner, so they never diverge. Refuelling is not modelled, so this is a pure tyre-change loss: modern stops are transit-dominated (pit-lane speed limit since 1994) at ~22s, rising for slower 1990s/2000s crews (~30s in 1996). The runtime adds a small symmetric execution jitter on top (a clean vs scruffy stop); the planner uses the clean mean. The player sees a "Pit loss ~Ns" estimate in the race header.

Teammate double-stacking: when two teammates pit on the same lap, the trailing car arrives while the crew is still working the first. It loses only the crew-busy time the on-track gap has not already absorbed: max(0, crew-busy − gap). Crew-busy is the era's stationary portion, ~3s modern up to ~11s in 1996, so a car right behind loses the lot while one several seconds back loses little or nothing.

Final computed laptime
Each lap, a player can see the lap time that each car will have the next lap. 

# Mistakes and retirements
Beyond the contested-overtake collision (in the simulation engine above), two more retirement sources run per lap:

Driver mistakes (issue #59): each lap, a consistency-scaled chance of a mistake, rate(c) = 1.3e-5 * (100 - consistency)^2 (consistency 65 -> ~1.6%/lap, 75 -> ~0.8%, 90 -> ~0.13%). On a mistake, 20% of the time the driver crashes out (collision-damage retirement); the other 80% is a one-off time loss of 2 + Exp(mean 3) seconds, clamped to [2, 25].

Technical reliability (issue #61): mechanical DNFs are era-accurate and FLAT across all cars — there is no per-team reliability, only the year matters. The per-race technical-DNF probability tracks the real-world trend: ~27% in 1996 decaying to ~3.4% by the mid-2020s, with a bump at the 2014 turbo-hybrid introduction (~12%) and a smaller mid-2000s dip. It is converted to a per-lap rate so season-long attrition is independent of circuit length. On a technical DNF the cause is drawn uniformly from: engine, gearbox, hydraulics, electrical, suspension, brakes, clutch, overheating.

Every retirement carries a named reason: "collision-damage" covers all crashes (driver mistakes + overtake collisions), the rest are technical.

# Stats Engine
The stats engine collects raw data from every race and stores it in a structured database. It also computes processed data programatically, and calculates season-wide strats, feats, and compares teammates to each other and compares predicted vs actual performances. I need you to propose all the possible programatically calculatable processed stats, feats, records that can be feasibly done by this engine without LLM support, even if most of the time, these searches are fruitless (most of the time, a record or a feat is not set during an avertage race). Because if we DO detect a statistical anomaly or a feat or record, then it becomes very much newsworthy and can have a dedicated article in the newsroom.

As mentioned above, the LLM model used for the news can tap on any of the stats engine "APIs", and always knows what is available, in writing any on demand news articles that the player is wanting to find. For the more routine news articles, the race data, general season data, standings etc should serve as the general minimal information needed to write the race report and other things.

# Points System
Points are era-accurate — the system in force matches the real F1 season being played (issue #63), selected by year, not player-customisable:
- 1996-2002: top 6 score 10-6-4-3-2-1.
- 2003-2009: top 8 score 10-8-6-5-4-3-2-1.
- 2010-2018: top 10 score 25-18-15-12-10-8-6-4-2-1.
- 2019-2024: as 2010-2018, plus 1 point for fastest lap, awarded only if the fastest-lap setter finishes in the top 10.
- 2025 onward: top 10 as above, the fastest-lap point dropped.

Every clinch / "uncatchable" calculation keys off the active season's table (and its fastest-lap rule), so a title is never over- or under-claimed across eras — a 1998 win is worth 10, not 25.

# Calendar
The race calendar is era-accurate (issue #64): each season plays the real-world calendar for that year, 1996-2026 — real circuits in championship round order, the real round count (16 in 1996 up to 24 in 2024-26), real race dates, and real lap counts. It is held as a circuit registry (each venue's stable attributes: code, location, country, cosmetic flat modifier) joined with per-season tables (the year's ordered schedule: circuit, GP name, lap count, and race-day Sunday-of-year). Historical-only circuits get a researched lap count and a plausible flat modifier. The calendar is selected by the season's year and is not editable by the player.

# Qualifying
Qualifying follows the standard 2026 F1 format: three sessions (Q1, Q2, Q3). For simplicity, weather is held constant within each session (intended dry-weather chance ~82.5%, matching the race rain rate; if wet then randomise [1, 100]). Qualifying weather is not yet implemented — the engine currently runs qualifying dry. Each driver gets exactly two flying laps per session; their fastest lap from those two attempts is kept. The grid order for the race is determined by Q3 results for the top 10, Q2 results for positions 11–15, and Q1 results for the remainder. Driver form, car pace, driver pace, wet-weather ability, and the circuit modifier all apply to qualifying lap times using the same simulation engine formulas as the race, minus tyre wear, fuel load, and the DRS/overtaking logic.

# Season Flow
Outside of races, the simulation advances through discrete time steps that the player manually triggers:

- **Pre-season \<year\>** — driver market moves, new teams joining, and car performance resets happen here.
- **Pre-race N** — the player can view pundit predictions, inspect tyre and weather forecasts, and edit god-mode fields before starting qualifying and then the race.
- **End of season** — the end-of-season reshuffle runs, driver development applies one final time, retirements are assessed, and the season is archived. Driver market activity (signings, releases) also opens here before rolling into the next pre-season.

Driver market moves (signings between teams) happen during the End of season and Pre-season windows.

# Driver Market

## Contracts
Each driver on an F1 seat holds a contract with a field `contract_expires_after_season`. Contracts are binding — neither the team nor the driver can break them. The only exceptions are god-mode actions (the player can forcibly release a driver or extend a contract).

Contract length is determined at signing time by the driver's **standing among next season's grid**, not an absolute media score. Media scores are compressed (most drivers cluster in a narrow band), so an absolute-threshold scheme hands almost everyone a short deal; ranking instead keeps the spread meaningful and makes the share of 1-year deals stable.

**Base length** — from the driver's media-score **percentile** across next season's grid (everyone staying plus everyone signed in this window; the unsigned pool is excluded). The percentile `p` runs 0 (weakest on the grid) to 1 (strongest):
> `mean_length = 1 + p × 3`  → weakest ≈ 1 year, strongest ≈ 4 years

The actual length is `round(Normal(mean_length, 0.9))`, clamped to [1, 4]. Sampling from a normal means no length is ever impossible for a given driver — a top driver can occasionally land a short deal and vice versa, just rarely. This puts roughly the bottom third of the grid on ~1-year deals (≈⅓ of all signings) regardless of the absolute media scale.

**Age modifier** — applied to the mean before sampling:
- Past `prime_end`: length is drawn from `Normal(1.3, 0.6)` clamped to [1, 2] — short rolling deals (mostly 1, sometimes 2); teams won't commit long-term to a driver in decline.
- Within 2 seasons of `prime_end`: `mean_length −= 0.7`.
- More than 2 seasons before `prime_end`: no change.

A 5-year contract is reserved for the single highest-ranked free agent by media score, and only if they are not past their `prime_end` (their clamp ceiling is raised to 5). No other driver can exceed 4 years.

## Free agency and seat-filling
At the end of each season, drivers whose `contract_expires_after_season` matches the completed season, and who are not retiring, enter the free agent pool.

Seat-filling uses **driver-proposing deferred acceptance** (Gale–Shapley with team capacity). This yields a *stable* outcome: there is no free agent and team who would both rather have each other than what they ended up with. Both sides matter — a driver cannot take a seat the team doesn't also want them in.

Preferences are sampled **once** and then held fixed for the whole process:

- Each free agent ranks every team that has an open seat by perceived attractiveness: `perceived = media_team_score + stay_pull + Normal(0, 10)`, where `stay_pull = 12` is added only for the driver's current team — a pull to re-sign, so a driver only leaves for a clearly better seat.
- Each team scores every free agent by perceived value: `perceived = media_driver_score + Normal(0, 8)`, plus a **retention bonus** if it offered to re-sign him (below), plus the youth bonus and minus the ring-rust penalty below.

The matching then runs:

1. Each unsigned free agent proposes to the most attractive team on their list that they have not yet approached.
2. Each team tentatively holds the best proposers up to its number of open seats (by the team's perceived value) and turns the rest away.
3. A turned-away driver proposes to their next choice; a held driver can later be bumped if a stronger proposer arrives. Repeat until no driver has an untried team left.

Tentative holds become signings once it settles. Any seat still empty (more seats than free agents) is filled by a generated rookie. For each team, the free agents it turned away are recorded against the seats it filled — the raw material for "who beat whom, and why" transfer stories. Proposing in any order produces the same stable result, so processing order does not matter.

**Media team score** is derived from constructors championship points over the last 1–3 available seasons, weighted 3:2:1 toward the most recent, normalised to a 0–100 scale.

**Re-sign offer (retention)**: at the end of the season a team decides whether to *offer* an expiring driver a new deal, based on how he performed **relative to what his car deserved** — not on his absolute media rank, which is too volatile season-to-season to keep consistent drivers in place. Define

> `delta = (2 × car_pace_rank − 0.5) − (0.3 × avg_grid_pos + 0.7 × avg_race_pos)`

i.e. the seat's expected finish from the car's *pace* ranking (fastest car ≈ P1/P2, etc.) minus the driver's race-weighted average finish. Positive `delta` = he beat his car. The team offers to re-sign with probability `sigmoid((delta − 4) / 2)`: a clear overperformer is almost always offered, a driver who merely meets his car's level is offered less often but still competes, and a clear underperformer is usually let go. An **offer is not a lock** — it adds a +25 retention bonus to that team's perceived value of him, but he still goes through the matching and may leave for a clearly better team that wants him, or be replaced if his team passed. This keeps a consistent performer at his team through the noise of a fluctuating media rank, while a genuine slump opens the door to a replacement.

**Youth bonus**: a young free agent's perceived value gets a small bump (`+max(0, min(4, 23 − age))`, so nothing from ~23 on) — enough that a tantalising prospect can occasionally prise a seat from an incumbent, never enough to threaten a settled mid-career driver.

**Ring rust**: when a team evaluates a free agent who is currently out of F1 (held no seat last season), their perceived value takes a small flat penalty. Teams favour proven drivers, so the grid does not churn wildly between the pool and seated drivers every year — but the penalty is small enough that a standout prospect still forces their way in.

## God-mode overrides
The player can, at any time during the End of season or Pre-season windows:
- Forcibly release a driver from their contract (the seat opens immediately for that window).
- Extend a driver's contract by any number of seasons.
- Manually assign any uncontracted driver to any open seat, bypassing the matching algorithm entirely.

# Grid Changes (God Mode)
Teams can only enter or exit the grid via a god-mode action, and only take effect at the start of the **following** season (i.e., the remainder of the current season plus one full additional season plays out under the existing grid before the change takes effect). New teams enter with the lowest-ranked car pace on the grid. Departing teams are removed cleanly at season end; any drivers on their roster re-enter the driver market.

# Driver Retirement
A driver who has not held an F1 seat for five consecutive seasons is removed from the driver market. Drivers who have driven in F1 keep their archived history when removed; generated drivers who never made the grid are discarded.

# Media-perceived ability
The media-perceived score is computed at the end of each season and used for contract length, the Home Screen driver rankings, and pundit predictions. It is a number on a 0–100 scale derived from four inputs.

**Component A — Raw results score (weight: 35%)**
The driver's championship points expressed as a percentile **within the current grid** (drivers who actually raced; free agents are excluded so they don't dilute the percentile). The last-place driver scores 0, the leader scores 100. This is what the media most visibly tracks, but it is heavily car-dependent — a weak driver in a fast car still banks points — so it is no longer the dominant signal (see Component B).

**Component B — Teammate H2H score (weight: 45%)**
Captures how the driver performed against their teammate in the same car — the clearest car-independent read on driver skill, and therefore the dominant signal. The H2H ratio combines qualifying and race head-to-head:
- Qualifying H2H: fraction of qualifying sessions where the driver was faster than their teammate (0–1)
- Race H2H: fraction of races where the driver finished ahead of their teammate, among races both drivers finished (0–1)
- Combined ratio: `h2h_ratio = 0.4 × qual_h2h + 0.6 × race_h2h`

The score swings around a **neutral baseline of 50**:
> `B = clamp( 50 + (h2h_ratio − 0.5) × 40 , 0, 100 )`

An even split scores 50, dominating a teammate reaches 70, being dominated drops to 30. B is deliberately **not** anchored to the teammate's own results: a bad car suppresses both drivers' points, so anchoring B to the teammate's score would penalise a driver twice for the same bad car. Beating your teammate is worth the same regardless of the car — absolute performance is already captured by Component A.

**Component C — Car-adjusted overperformance (weight: 20%)**
Measures how much the driver outperformed their expected share of team points, scaled by how hard their car made that task:
- Expected points share = 50% (two equal drivers split evenly)
- Actual share = `driver_points / team_total_points`
- Overperformance = `actual_share − 0.5`
- Car difficulty multiplier = `constructors_rank / total_teams` (worst car = 1.0, best car ≈ 0.1)
- Raw C = `0.5 + overperformance × car_difficulty_multiplier`, normalised to [0, 100]

This partially rewards drivers who maximise an uncompetitive car without allowing them to leapfrog drivers in clearly faster machinery.

**Narrative modifier (flat additive, god-mode editable)**
A constant per-driver value in the range [−20, +20], defaulting to 0. Added to the final weighted score after A, B, and C are combined. Represents the media halo (or deficit) a driver carries independent of results — some drivers are perceived as generational talents, others are chronically underrated or overrated by pundits. When pre-populating real-world 2026 drivers, sensible non-zero defaults are applied. Procedurally generated drivers always start at 0. The player can edit this value at any time via god mode.

The modifier **fades as a driver declines past their `prime_end`**, so a media darling cannot coast on reputation once the results dry up:
> `narrative_effective = narrative_modifier × clamp(1 − 0.25 × max(0, age − prime_end), 0, 1)`

It applies at full strength up to `prime_end`, then loses a quarter of its value per season past prime, reaching 0 four seasons after prime. (A driver at or before their prime is unaffected.) The fade is symmetric: a negative modifier (an underrated/maligned driver) decays toward 0 just like a positive halo — as a driver ages out of relevance, reputation in either direction stops carrying and they are judged on current results.

**Final score**
> `media_score = clamp(0.35×A + 0.45×B + 0.2×C + narrative_effective + pace_narrative, 0, 100)`

**Free agents (didn't race)** run through the *same* formula, which lands them at a low baseline — `A = 0` (no points), `B = 50` (no teammate), `C = 50` (no constructor) → `0.35×0 + 0.45×50 + 0.2×50 = 32.5`. With no results to judge, their raw pace is the only signal, so it is converted into a narrative swing:
> `pace_narrative = clamp( (pace − 68) × 0.8 , −20, +20 )`  (free agents only; 0 for everyone who raced)

So an average-pace free agent sits well below proven grid drivers, while a genuinely fast prospect can climb toward the midfield — but rarely past a proven driver, especially once the market's out-of-F1 ring-rust penalty is applied on top.

# In-race retirements
Each lap, every active driver has a flat per-lap mechanical retirement probability of **0.2%** (≈11% over a ~58-lap race, so roughly 2 retirements per 20-car field, ~2.6 DNFs per driver per season). Longer circuits with more laps will naturally produce slightly more retirements; shorter circuits slightly fewer. No other factors influence the mechanical retirement rate. When triggered, the retirement is treated identically to a god-mode forced retirement — the car is out and cannot return.

# Standings Screen — Colour Coding
Race result cells in the standings grid are colour-coded as follows, matching the Wikipedia F1 convention:
- **Yellow** — 1st place (win)
- **Grey** — 2nd place
- **Burnt orange** — 3rd place
- **Light green** — 4th–10th place (points finish, not podium)
- **Light blue** — 11th and below (non-points finisher)
- **Purple** — retirement (DNF)
- **Black** — disqualification (DSQ; currently only occurs via god mode)

