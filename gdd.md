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
Each driver's age is tracked, along with their peak potential and prime end. The period before a driver reaches their peak is when they will develop at a fast rate (slowing down as they age but continuing to be positive until their potential is reached). At their prime end age, whether or not they have reached their potential, they will start to decline, with the decline accelerating as they age further past their prime end. Different drivers have different potentials and prime end ages. At setup, a pool of free-agent drivers is generated; thereafter, new drivers are generated each season only as needed to fill any seats left vacant after the free-agent market has run. These generated drivers cannot immediately be the top drivers, but some can have the potential to do so.

The progression happens after each race. Generation happens after each season. After each season, drivers who have not been in F1 for five years are removed from the driver market. Drivers who have driven in F1 who are retired will have their history archived.

Progression before peak is also RNG: take 20 * years till prime end to calculate a rough number of races to reach potential, then calculate overall (detailed below) and take gap between current overall and potential, then divide that gap by number of races to potential. This value will act as the lower quartile on the normal curve, this value * 1.5 will act as the median on the normal curve, and we will randomly calculate the actual improvement, then apply this improvement to every stat (with some small random noise to prevent a completely uniform improvement across stats).

Note that drivers have 4 stats: pace, wet-weather pace, overtaking and smoothness. All of them are out of 100. The overall stat (just for user-friendliness) is calculated by taking 0.6\*pace + 0.2\*smoothness + 0.1\*overtake + 0.1\*wet weather pace. This is just a cosmetic overall that the player can use to sort, however it is used to see if the driver has hit his potential (which means no further improvement can happen, and the driver can only plateau until prime end)

# Simulation engine
For a given lap, the simulation works like this:
A car with 75 pace will take exactly 100 seconds.
This is modified by driver pace, where 75 means no effect, every +5 driver pace maps to a 0.1 second bonus, every -5 maps to a 0.1 second penalty, varied linearly.
Tyre wear: every 8% of tyre wear adds 0.1 to the laptime, varied linearly. If tyre condition hits 0%, a 5s per lap penalty is applied.
Weather: every 5% of moisture adds 1s to the laptime, varied linearly. If tyres are outside their moisture window, an additional 30s per lap penalty is applied. For every step the tyres are wrong, an additional 15s per lap penalty is applied: STEPS are dry, intermediate, wet. In completely dry conditions, having wet tyres has an additional 15s penalty compared to intermediate tyres, as it is a further step out of range. Same applies to dry tyres in completely wet conditions compared to intermediate tyres.
Wet-weather ability: the driver's pace and the wet weather ability will be summed up linearly, such that percentage moisture * wet weather + (1 - percentage moisture) * pace will be used as the final pace value.
Fuel load: every 1 lap of fuel corresponds to 0.05 seconds.
Tyre delta: soft tyres have no modifier, medium tyres add 0.7 seconds per lap, hard tyres add 1.5 seconds per lap. Intermediate tyres add 2.5 seconds per lap. Wet tyres add 4 seconds per lap.
Form modifier: a driver's form can range between 0 and 10. This form lasts the entire race weekend (including qualifying). At 5, there is no bonus or penalty. Every +1 or -1 will add to the pace calculation directly. Form is randomised pre-race as a normal distribution, and the player can view this pre-race and edit the form.
Car form: each team has a per-race randomised value that affects both drivers equally, since it affects the car pace, modelling the car simply having a good or bad weekend. It is purely per-race random (not track-specific affinity). It is a normal distribution centred on 0 with a standard deviation of about 5.19, chosen so its quartiles sit at +/-3.5, and the value adds directly to the car's pace calculation. At 0 there is no bonus or penalty. It is re-rolled each race, identical for both of the team's cars, and clamped to +/-25 as a safety bound on the otherwise-unbounded tail.
A per circuit modifier will add a flat X seconds to the final time, where X can be positive or negative or zero. This allows laptimes to look different across different circuits. It serves a purely cosmetic function and does not affect any relative times.
During the race, the gap to car ahead affects the lap time calculation. If the gap to car ahead is between 1s and 2s, the car behind cannot overtake the car in front unless the car behind is more than 2*x seconds faster that lap, where x is the gap before the start of the lap (and is thus clamped to a laptime that causes that car to be 0.5 seconds + some random noise between 0 and 0.5 seconds behind that car). 
If the gap to the car ahead is between 0 and 1s, and the calculated lap time is faster than the car ahead, then the player's overtaking stat will be used: ((1 - gap in s) + (overtaking stat/2))/2 will be the probability of the overtake happening. If the overtaking happens, the position swaps and no other penalty is applied to either car. If the overtaking fails, then the player's laptime is clamped such that the gap to the car in front remains some noise between 0 and 0.5 seconds.
Random modifier: a noise of [0s, 0.3s] is applied to the calculated lap time.

Teams will do live-race heuristics to decide when to pit. They will do it as smart as possible but with imperfect information, so that each team will achieve reasonable pit strategy without knowing exactly their car pace, driver pace and all other simulation inputs, but not all teams will achieve optimal, lap-perfect pit strategy. They do this per-car per-lap. AI agent, you will have to propose to me how you intend to achieve this.

Cars are fuelled identically, and exactly one lap of fuel burns off per lap, so this is purely cosmetic to make lap times come down.

Tyres data:
SOFT: 100% can last 20 + [-5, 5] percent of race distance. Moisture window is 0 to 25%.
MEDIUM: 100% can last 30 + [-5, +10] percent of race distance. Moisture window is 0 to 15%.
HARD: 100% can last 45 + [-5, +10] percent of race distance. Moisture window is 0 to 15%.
INTERMEDIATE: 100% can last 30 + [-5, +10] percent of race distance. Moisture window is 10% to 45%.
WET: 100%  can last 45 + [-5, +10] percent of race distance. Moisture window is 35% to 80%.
A smoothness of 100 can make the tyres last 1.5x as long as the base. A smoothness of 0 can only make the tyres last 0.5x as long as the base. A smoothness of 50 has no bonus or penalty.

Weather data:
Pre-race, the weather curve is calculated. About 67% of the time, the race should be completely dry. In the other 33% of the time, the race should start dry half the time. The direction of the rain (gets more wet, stays the same, gets more dry) is randomised every 5 laps. The magnitude of the rain is randomised as [-1, 4] (so note that it can contradict the direction 20% of the time). 

Pit stop:
The in-lap to a pit stop adds 10s plus some noise between [0, 2]. The out-lap of a pit stop adds 10s plus some noise between [0, 2].

Final computed laptime
Each lap, a player can see the lap time that each car will have the next lap. 

# Stats Engine
The stats engine collects raw data from every race and stores it in a structured database. It also computes processed data programatically, and calculates season-wide strats, feats, and compares teammates to each other and compares predicted vs actual performances. I need you to propose all the possible programatically calculatable processed stats, feats, records that can be feasibly done by this engine without LLM support, even if most of the time, these searches are fruitless (most of the time, a record or a feat is not set during an avertage race). Because if we DO detect a statistical anomaly or a feat or record, then it becomes very much newsworthy and can have a dedicated article in the newsroom.

As mentioned above, the LLM model used for the news can tap on any of the stats engine "APIs", and always knows what is available, in writing any on demand news articles that the player is wanting to find. For the more routine news articles, the race data, general season data, standings etc should serve as the general minimal information needed to write the race report and other things.

# Points System
Points are awarded using the standard F1 system: 25-18-15-12-10-8-6-4-2-1 for positions 1 through 10. No point is awarded for fastest lap. The points system is not customisable.

# Calendar
The race calendar follows the real-world 2026 F1 season calendar. The agent implementing the simulation will look up real-world lap times for each circuit and determine reasonable per-circuit flat modifiers accordingly. The calendar is not editable by the player.

# Qualifying
Qualifying follows the standard 2026 F1 format: three sessions (Q1, Q2, Q3). For simplicity, weather is held constant within each session (dry weather chance is still 67%; if wet than randomise [1, 100]). Each driver gets exactly two flying laps per session; their fastest lap from those two attempts is kept. The grid order for the race is determined by Q3 results for the top 10, Q2 results for positions 11–15, and Q1 results for the remainder. Driver form, car pace, driver pace, wet-weather ability, and the circuit modifier all apply to qualifying lap times using the same simulation engine formulas as the race, minus tyre wear, fuel load, and the DRS/overtaking logic.

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

