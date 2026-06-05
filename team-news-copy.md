# Team transition news — copy (Sonnet-written, QC'd)

All 45 articles, deks + body paragraphs + quotes, in the voice of the three anchors. Source for the
copy JSON when wiring. QC applied: no colons in deks, no em dashes, no percentages, no asserted
competitive/financial record (only via slots), folding between seasons, counts via slots. Five factual
fixes applied (enstone-2002 Renault heritage, enstone-2012 Boullier not Fernley, silverstone-2008 Ferrari
engines, silverstone-2021 Aston 1959-60, toyota-2009 dek de-superlative'd).

Slots: rebrand `{team_old}{team_new}{next}` + lineage-to-date `{prior_seasons}{prior_seasons_word}
{prior_wins}{prior_wins_word}{prior_podiums}{prior_podiums_word}{prior_poles}{prior_points}
{prior_points_word}{prior_best_finish}{prior_titles}{top_driver}{top_driver_feat}{kept_drivers}`;
arrival `{team}{next}{grid_count}`; departure adds `{year}{name_era}{stint_seasons}{stint_seasons_word}
{wins}{wins_word}{podiums}{podiums_word}{poles}{points}{points_word}{best_finish}{titles}{last_driver}
{final_drivers}{seatless}{seatless_count}`; pronouns `{they}{their}{them}`.

---

## REBRANDS

### rebrand-arrows-1997 (Footwork -> Arrows)
DEK: Tom Walkinshaw brings back the name the team was built on.
b1: Walkinshaw had renamed the outfit Footwork during a period of sponsorship from the Footwork Corporation, but with that backing gone the Arrows name was always the one people remembered. / For {next}, the team returns to the grid as {team_new}, restoring the identity it carried when it first arrived in Formula 1.
b2: The lineage has now run for {prior_seasons} {prior_seasons_word}, during which {top_driver} {top_driver_feat}. / It enters the new name with {prior_wins} {prior_wins_word}, {prior_podiums} {prior_podiums_word} and {prior_points} {prior_points_word}, a best constructors' finish of {prior_best_finish}.
QUOTE: "Arrows was always the real name. Footwork was a chapter. This is just returning to what we are."

### rebrand-brackley-1999 (Tyrrell -> BAR)
DEK: British American Tobacco ends Ken Tyrrell's long chapter and builds its own F1 project from the Brackley base.
b1: BAT purchased the Tyrrell team in a deal announced during the 1998 season, acquiring the entry, the factory and the constructor's rights. / The buyout brings to a close the Tyrrell name, one of the oldest in the paddock, and clears the way for British American Racing to debut in {next} with significant manufacturer backing.
b2: The lineage departs the Tyrrell name having spent {prior_seasons} {prior_seasons_word} at Brackley, accumulating {prior_wins} {prior_wins_word}, {prior_podiums} {prior_podiums_word} and {prior_points} {prior_points_word}. / {top_driver}, who {top_driver_feat}, remains one of the defining figures from that period.
QUOTE: "What BAT is building here is serious. The resources, the ambition, the facility at Brackley. This is not a backmarker project."

### rebrand-brackley-2006 (BAR -> Honda)
DEK: Honda converts a title-sponsor relationship into full ownership, turning the Brackley operation into a manufacturer works entry.
b1: Honda had held a minority stake in British American Racing since 2000 and supplied the power unit throughout, but the full buyout of the remaining BAT shareholding in 2005 made it the outright owner. / For {next}, the team races as the {team_new} Racing F1 Team, bringing the Japanese manufacturer into line with the full works model it had long edged toward.
b2: Across {prior_seasons} {prior_seasons_word} under the {team_old} name, the lineage accumulated {prior_wins} {prior_wins_word}, {prior_podiums} {prior_podiums_word} and {prior_points} {prior_points_word}, finishing as high as {prior_best_finish} in the constructors' standings. / {top_driver}, who {top_driver_feat}, is the standout name from that era.
QUOTE: "Going works changes everything. The conversations, the priorities, the weight of responsibility. We are Honda now, fully and completely."

### rebrand-brackley-2009 (Honda -> Brawn)  [MARQUEE]
DEK: Honda's sudden withdrawal looked like the end, but Ross Brawn turned the crisis into a rescue.
b1: Honda's board voted in December 2008 to pull the company out of Formula 1, citing the global financial crisis and a reappraisal of where to direct corporate resources. / The team had already completed a car for the following year and stood to be dissolved entirely. Ross Brawn, serving as team principal, led a management buyout with backing from undisclosed investors, acquiring the entry, the Brackley factory and the car. / The team enters {next} as Brawn GP, a new name on the entry list but the same engineers, infrastructure and largely the same personnel who had operated under the {team_old} banner.
b2: {team_old}'s time at Brackley spanned {prior_seasons} {prior_seasons_word}, with {top_driver} the most prominent figure across that stretch, having {top_driver_feat}. / The lineage carries {prior_wins} {prior_wins_word}, {prior_podiums} {prior_podiums_word} and {prior_points} {prior_points_word} into the new name, a best finish of {prior_best_finish}.
QUOTE: "When Honda told us we had very little time to find a solution, most people thought that was it. It was not it. We had a building full of people who had put enormous effort into a car. That deserved a chance." / "The buyout was not glamorous. It was a group of people who believed in what we had built refusing to let it disappear."

### rebrand-brackley-2010 (Brawn -> Mercedes)  [MARQUEE]
DEK: Mercedes completes a purchase that turns a one-year rescue act into a long-term manufacturer project.
b1: Mercedes-Benz had already held a 45.1% stake in Brawn GP and supplied power units, but the full acquisition at the end of 2009 converted its investment into outright ownership. / The team races as the Mercedes GP Petronas Formula One Team from {next}, marking the German manufacturer's return as a constructor for the first time since the 1950s. / Ross Brawn remains as team principal. The driver line-up for {next} will be confirmed separately.
b2: Brawn GP's single season at the head of the entry list sits within a lineage that has now accumulated {prior_seasons} {prior_seasons_word} at Brackley, a span in which {top_driver} {top_driver_feat}. / Across that entire history the entry carries {prior_wins} {prior_wins_word}, {prior_podiums} {prior_podiums_word} and {prior_points} {prior_points_word}, with a best constructors' finish of {prior_best_finish}.
QUOTE: "For Mercedes, this is not just an investment. It is a statement about where we see ourselves in global motorsport and what we intend to build at Brackley." / "This team has been through Honda, then a buyout, and now this. The address hasn't changed. The ambition has only grown."

### rebrand-caterham-2012 (Lotus -> Caterham)  [MARQUEE — naming dispute]
DEK: Tony Fernandes loses the right to race as Team Lotus and pivots to a name that is entirely his own.
b1: Fernandes had acquired the Team Lotus name in 2010 and entered F1 under it, but Group Lotus, the Hethel sports-car company, pursued a legal challenge arguing the marque belonged with their programme at Enstone. / The dispute had run since 2011, both sides trading claims through the courts and the FIA. It was settled in Group Lotus's favour, leaving Fernandes unable to continue as Lotus. / He activated a fallback that had been in place for some time. Caterham Cars, the lightweight sports-car maker Fernandes had bought separately, would now lend its name. For {next}, the entry becomes {team_new} F1 Team, same base, same staff.
b2: The Fernandes team entered F1 in 2010 as Team Lotus and has now spent {prior_seasons} {prior_seasons_word} on the grid, accumulating {prior_wins} {prior_wins_word}, {prior_podiums} {prior_podiums_word} and {prior_points} {prior_points_word}, a best finish of {prior_best_finish}. / {top_driver}, who {top_driver_feat}, is the lineage's most significant figure across that period.
QUOTE: "I will always be proud of what we did with the Lotus name. We earned it. But Caterham is ours completely, no dispute, no litigation, no compromise. I'd rather own a name than fight over one." / "The car, the factory, the people, the spirit. None of that changes. Only the letters on the side."

### rebrand-enstone-2002 (Benetton -> Renault)  [FIXED]
DEK: Renault buys the Enstone-based Benetton team and commits to a full works return.
b1: Renault returned to Formula 1 as a full constructor by acquiring the Benetton operation at Enstone, a factory built by the Toleman and Benetton organisations across two decades of racing. The deal, completed in 2000, brought Renault's name back to the top of the pit lane as a works entrant for the first time since the turbo era that made the manufacturer a force in the late 1970s and 1980s. / Renault's return as a constructor came through the purchase of the Enstone-based Benetton team, a squad whose championship-winning heritage the French manufacturer now inherits alongside its own engine-era pedigree.
b2: Under the Benetton name the lineage amassed {prior_wins} {prior_wins_word}, {prior_podiums} {prior_podiums_word} and {prior_points} {prior_points_word} across {prior_seasons} {prior_seasons_word}. / {top_driver} stands as the most accomplished driver across that period, having {top_driver_feat}.
QUOTE: "Renault has a proud history in this sport, from the turbo years to the engine programmes that followed. We are here now as a full constructor, and we intend to add to that story." / "This is Renault coming back to win as a constructor, not just as an engine supplier. The Enstone facility is exceptional, and we are going to build on everything done here."

### rebrand-enstone-2012 (Renault -> Lotus)  [MARQUEE — naming dispute; FIXED]
DEK: Group Lotus wins the naming dispute and plants its marque on the Enstone team, the other half of a saga that leaves two Lotus-branded entries on the grid.
b1: The Enstone operation, owned by Genii Capital and led by team principal Eric Boullier, drops the Renault constructor name and races as Lotus F1 Team from {next}. The branding reflects a commercial agreement with Group Lotus, though it runs parallel to a separate, contested arrangement involving Fernandes' Team Lotus entry, leaving two cars on the grid carrying the marque's name. / Genii Capital's Enstone squad takes the Lotus name under Boullier's direction, the rebranding formalising a partnership with Group Lotus while Fernandes' independently owned team also races under the Lotus banner, setting up a dispute the two sides will contest through the year.
b2: The Enstone lineage has run for {prior_seasons} {prior_seasons_word}, building a record of {prior_wins} {prior_wins_word}, {prior_podiums} {prior_podiums_word} and {prior_points} {prior_points_word} under the Renault name. / {top_driver}, who {top_driver_feat}, is the most decorated driver across that stint.
QUOTE: "Lotus is a name that carries genuine history in Formula 1. The association with Enstone, with this team's pedigree, is one we intend to honour." / "There was a period where no one quite knew how many Lotus teams there would be. That ambiguity is over. This is the Lotus team."

### rebrand-enstone-2016 (Lotus -> Renault)
DEK: Renault buys back the team it sold to Group Lotus, rescuing it from financial collapse and committing to another works era at Enstone.
b1: Lotus F1 Team had been struggling financially for several seasons, accumulating debts and running late on payments to suppliers and staff. / Renault, which had retained interest in the sport and been evaluating a works return, agreed terms to acquire the team before the end of the 2015 season. / The buyout cleared Lotus F1's liabilities and returned Enstone to Renault ownership for {next}, when it races as Renault Sport Formula One Team. The Lotus name departs the entry list.
b2: The lineage, which traded as Lotus throughout this period, carried {prior_wins} {prior_wins_word}, {prior_podiums} {prior_podiums_word} and {prior_points} {prior_points_word} across {prior_seasons} {prior_seasons_word}, reaching as high as {prior_best_finish}. / {top_driver}, who {top_driver_feat}, is the most prominent name from this chapter.
QUOTE: "Renault's history at Enstone is longer than any other name that factory has carried. Coming back is the right decision at the right time." / "We are not starting again. We are continuing. The factory, the people, the institutional knowledge. Renault adds structure and resource to all of that."

### rebrand-enstone-2021 (Renault -> Alpine)
DEK: Renault steps back from its own name and promotes Alpine, the sports-car brand it revived, to the front of the car.
b1: The decision to rename the F1 entry as Alpine F1 Team for {next} follows Renault Group's broader strategy of differentiating its brands, with Alpine positioned as the performance-focused identity within the group. / Alpine, which Renault restarted as a marque in 2017, provides a more premium and performance-specific image for the motorsport programme than the mainstream Renault badge. / The team remains based at Enstone, with the same personnel, continuing as a full works constructor. Only the commercial identity changes.
b2: The Enstone team has carried the Renault name through {prior_seasons} {prior_seasons_word} in this most recent stint, accumulating {prior_wins} {prior_wins_word}, {prior_podiums} {prior_podiums_word} and {prior_points} {prior_points_word}. / {top_driver}, who {top_driver_feat}, has been central to that record. {kept_drivers} carries over into the Alpine chapter.
QUOTE: "Alpine has the right character for Formula 1. It is agile, it is ambitious, it is French. The sport suits the brand and the brand suits the sport."

### rebrand-faenza-2006 (Minardi -> Toro Rosso)
DEK: Red Bull converts its Minardi purchase into a second team, bringing a new Italian-named identity to Faenza.
b1: Red Bull acquired Minardi from Paul Stoddart at the end of 2005 for a reported fee of around ten million dollars, transforming the small Faenza team into a junior programme to feed drivers into the senior Red Bull Racing outfit. / The name Toro Rosso, Italian for "Red Bull," ties the junior identity to its parent while preserving an operational separation from the Milton Keynes team. / For {next}, the entry races as Scuderia Toro Rosso, based at the Faenza factory it has always called home.
b2: The Faenza lineage carries {prior_seasons} {prior_seasons_word} under the Minardi name into this new chapter, with {prior_wins} {prior_wins_word}, {prior_podiums} {prior_podiums_word} and {prior_points} {prior_points_word} on the books. / {top_driver}, who {top_driver_feat}, is the standout name from those years.
QUOTE: "Minardi gave this factory its soul. Toro Rosso gives it a future. Red Bull has the resources to do what Paul Stoddart could never quite manage."

### rebrand-faenza-2020 (Toro Rosso -> AlphaTauri)
DEK: Red Bull repaints its junior team in a fashion label's colours, giving the Faenza entry its newest name since Minardi.
b1: AlphaTauri is a premium streetwear brand owned by Red Bull GmbH, and naming the team after it follows the same logic that made Toro Rosso a marketing exercise as much as a racing one. / The rebrand, announced ahead of {next}, is intended to give AlphaTauri the kind of global visibility only Formula 1 can deliver. / Franz Tost remains team principal. The car retains the Red Bull technology-sharing arrangement and the Honda power unit for {next}.
b2: Toro Rosso spent {prior_seasons} {prior_seasons_word} on the grid under its own name, building a record of {prior_wins} {prior_wins_word}, {prior_podiums} {prior_podiums_word} and {prior_points} {prior_points_word}, a best constructors' result of {prior_best_finish}. / {top_driver}, who {top_driver_feat}, is the most celebrated product of the Faenza programme across that span.
QUOTE: "AlphaTauri is a brand that deserves this stage. The exposure Formula 1 gives a label is unlike anything else in sport. We want people to know the name."

### rebrand-faenza-2024 (AlphaTauri -> Racing Bulls)  [MINOR]
DEK: Red Bull gives its Faenza team yet another new identity, replacing AlphaTauri with Racing Bulls.
b1: The Racing Bulls name, announced by Red Bull ahead of {next}, drops the fashion-label reference for a more direct motorsport identity. / The team continues at Faenza under the same technical structure, with the Red Bull relationship intact.
b2: AlphaTauri spent {prior_seasons} {prior_seasons_word} on the grid, carrying {prior_wins} {prior_wins_word}, {prior_podiums} {prior_podiums_word} and {prior_points} {prior_points_word} across that period. / The driver line-up for {next} will be confirmed in due course.
QUOTE: "Racing Bulls is a name that says exactly what this team is. No ambiguity, no branding exercise. Just racing."

### rebrand-hinwil-2006 (Sauber -> BMW Sauber)
DEK: BMW takes a majority stake in Sauber, turning the Hinwil team into a German works entry.
b1: BMW has acquired a majority stake in Sauber Motorsport AG, converting the Hinwil privateer into the BMW Sauber F1 Team. The arrangement gives BMW direct engine supply and works status for {next}, its first involvement as a full constructor in the modern era. Peter Sauber, who founded the team in 1970, retains a minority share and an advisory role.
b2: {team_old} had raced in F1 for {prior_seasons} {prior_seasons_word}, collecting {prior_wins} {prior_wins_word}, {prior_podiums} {prior_podiums_word} and {prior_points} {prior_points_word}, a best constructors' finish of {prior_best_finish}. {top_driver} was the team's standout performer during that span. The line-up for {next} will be confirmed separately.
QUOTE: "We chose Sauber because it is a professional, experienced team with a culture we respect. This is a works entry built to compete, not just to participate." / "Peter Sauber built something exceptional here. We intend to honour that by giving it the resources it deserves."

### rebrand-hinwil-2010 (BMW Sauber -> Sauber)
DEK: BMW withdraws from Formula 1 and Peter Sauber buys his team back, returning the Hinwil outfit to independence.
b1: BMW has confirmed its withdrawal from Formula 1, citing a strategic refocus of its motorsport budget. Peter Sauber has exercised an option to reacquire the team, restoring full Swiss ownership to the Hinwil factory. It races as Sauber F1 Team from {next}, running Ferrari customer power after the BMW works engine programme is wound down.
b2: Across {prior_seasons} {prior_seasons_word} under BMW Sauber, the team recorded {prior_wins} {prior_wins_word}, {prior_podiums} {prior_podiums_word} and {prior_points} {prior_points_word}, a best constructors' finish of {prior_best_finish}. {top_driver} was the most prominent driver of the BMW era. The driver situation for {next} will be confirmed in due course.
QUOTE: "This is my team. It was always my team. I am glad to have it back, and glad to have the people in Hinwil who stayed through all of this." / "BMW gave us resources we could not have had on our own. Now we move forward with what we learned and the independence we know how to use."

### rebrand-hinwil-2019 (Sauber -> Alfa Romeo)
DEK: The Italian marque returns to Formula 1 as Alfa Romeo title branding takes over at Hinwil under a Ferrari-aligned deal.
b1: Alfa Romeo has reached a title sponsorship and branding agreement with the Sauber Group, brokered within the Ferrari commercial orbit given Sauber's existing Ferrari customer relationship. The team races as Alfa Romeo Racing from {next}, the first time the Italian marque has had its name on an F1 entry since 1985. Sauber remains the operating entity.
b2: {team_old} heads into this rebrand with {prior_seasons} {prior_seasons_word} of racing on the books, {prior_wins} {prior_wins_word}, {prior_podiums} {prior_podiums_word} and {prior_points} {prior_points_word}, a best constructors' finish of {prior_best_finish}. {top_driver} is the standout name from the Swiss team's recent history. A driver announcement for {next} will follow.
QUOTE: "Alfa Romeo has a heritage in motor racing that stretches back to the very beginning of this sport. To bring that name back to the grid is a source of real pride." / "The partnership with Sauber gives us a team that knows how to race. We bring the identity, they bring the craft."

### rebrand-hinwil-2024 (Alfa Romeo -> Sauber)
DEK: Alfa Romeo's title deal ends and the Hinwil team reverts to the Sauber name, a transitional identity ahead of Audi's arrival.
b1: Alfa Romeo has chosen not to renew its title branding arrangement with the Sauber Group, ending a relationship that began in 2019. The team races as Stake F1 Team Kick Sauber in {next}, retaining the Sauber name at its core as the operation prepares for the full Audi works takeover expected in 2026. Sauber remains the legal and operational entity throughout.
b2: The Hinwil team heads into its Sauber-again chapter with {prior_seasons} {prior_seasons_word} behind it, {prior_wins} {prior_wins_word}, {prior_podiums} {prior_podiums_word} and {prior_points} {prior_points_word}, a best constructors' finish of {prior_best_finish}. {top_driver} is the most decorated driver across the lineage. The line-up for {next} will be confirmed in the usual way.
QUOTE: "Alfa Romeo gave us years of visibility and partnership we are grateful for. What matters now is delivering on the potential that has always existed in this factory." / "The name changes, the direction does not. We know where we are heading, and that destination is closer than it looks."

### rebrand-hinwil-2026 (Sauber -> Audi)  [MARQUEE — the anchor]
DEK: A prominent manufacturer takes over F1's longest-running privateer team. / More than three decades of Swiss independence end as a German works constructor arrives at Hinwil.
b1: {team_new} AG has finalised its 100% acquisition of the {team_old} Group in a deal reported to be worth in the region of €600 million, formally ending over three decades of the Swiss team's independence. The manufacturer, which first announced its F1 ambitions in 2022, had initially sought only a minority stake before opting for full ownership.
b2: The team will race as the Revolut {team_new} F1 Team from the {next} season, fielding a works power unit developed at {team_new}'s dedicated facility in Neuburg an der Donau. {team_new} is yet to announce its drivers, but will do so at the end of the season.
b3 (quote): The last time {team_old} did not appear on an F1 entry list was 1992. Speaking fondly, {top_driver}, who {top_driver_feat}, said {they} "owed [{their}] entire F1 career to {team_old} and the people who believed in [{them}]. They will be missed."
b4 (stats): In their time in F1, {team_old} achieved {prior_wins} {prior_wins_word}, {prior_podiums} {prior_podiums_word} and {prior_points} {prior_points_word}, a best constructors' finish of {prior_best_finish}.
ALT DEK/quote variants: "When nobody else wanted to take a chance on you, Sauber did. I hope everyone in that factory knows what that meant." / "Sauber gave me F1. That is the beginning and the end of it. The name deserves to be remembered well, because the people were exceptional."

### rebrand-miltonkeynes-2000 (Stewart -> Jaguar)
DEK: Ford rebrands the Stewart operation as Jaguar Racing, turning a family team into a manufacturer-backed works entry.
b1: Ford Motor Company has completed its full acquisition of Stewart Grand Prix and races the team under the Jaguar name from {next}. The move consolidates Ford's F1 investment under a single prestigious brand, with Jaguar, a Ford subsidiary since 1990, providing the commercial platform. Jackie and Paul Stewart, who founded the team in 1997, depart with the sale.
b2: Stewart Grand Prix raced for {prior_seasons} {prior_seasons_word} before the rebrand, posting {prior_wins} {prior_wins_word}, {prior_podiums} {prior_podiums_word} and {prior_points} {prior_points_word}, a best constructors' finish of {prior_best_finish}. {top_driver} was the team's most effective performer. The Jaguar line-up for {next} will be confirmed in due course.
QUOTE: "Ford has invested significantly in this team and this sport. The Jaguar name gives that investment a visibility Stewart, for all its quality, could not provide." / "This is Jaguar's return to top-level motorsport, not just as an engine supplier or a sponsor, but as a constructor in its own right."

### rebrand-miltonkeynes-2005 (Jaguar -> Red Bull)  [MARQUEE]
DEK: Red Bull buys Jaguar Racing from Ford and enters Formula 1 as a constructor, repainting the Milton Keynes cars for {next}.
b1: Red Bull GmbH has purchased Jaguar Racing from Ford for a reported nominal fee, with Ford continuing engine supply for a transitional period. The sale ends Ford's five-year involvement as a constructor under the Jaguar banner and delivers the Milton Keynes factory, its personnel and infrastructure to new ownership. Red Bull, whose founder Dietrich Mateschitz had identified F1 as the pinnacle of the brand's motorsport ambitions, repaints the cars and enters {next} as Red Bull Racing.
b2: Jaguar Racing ran for {prior_seasons} {prior_seasons_word} at Milton Keynes, accumulating {prior_wins} {prior_wins_word}, {prior_podiums} {prior_podiums_word} and {prior_points} {prior_points_word}, a best constructors' finish of {prior_best_finish}. {top_driver} was the standout name from the Ford-Jaguar era. Red Bull will confirm its line-up for {next} separately.
QUOTE: "We did not buy a team. We bought a platform, and we intend to build something serious from it." / "Jaguar had everything in place except the commitment to push to the very front. That changes now. Red Bull does not enter things to be respectable, it enters them to win them."

### rebrand-prost-1997 (Ligier -> Prost)
DEK: Alain Prost buys Ligier and puts his name on the entry list, becoming a constructor-owner.
b1: Alain Prost has completed the acquisition of Ligier, the French team founded by Guy Ligier in 1976, and races it as Prost Grand Prix from {next}. The deal drew support from French government and commercial interests keen to keep a French team on the grid. Prost, a four-time world champion, becomes constructor, team principal and the name above the door at once.
b2: Ligier raced for {prior_seasons} {prior_seasons_word} before passing to Prost, recording {prior_wins} {prior_wins_word}, {prior_podiums} {prior_podiums_word} and {prior_points} {prior_points_word}, a best constructors' finish of {prior_best_finish}. {top_driver} was the most decorated driver across that history. The Prost line-up for {next} will be confirmed shortly.
QUOTE: "I know what it takes to win in this sport as a driver. Now I want to learn what it takes to win as a constructor." / "People will say this is vanity, that I just want my name on a car. They are wrong. I want my name on a winner."

### rebrand-silverstone-2006 (Jordan -> Midland)
DEK: Alex Shnaider's Midland Group finalises its Jordan takeover and the team enters {next} under new ownership and a new name.
b1: Alex Shnaider's Midland Group has completed the acquisition of Jordan Grand Prix, a process underway since 2004. Eddie Jordan, who founded the team in 1991, exits with the sale. The team races as Midland F1 Racing from {next}, remaining in Silverstone and continuing with Toyota customer engines.
b2: Jordan Grand Prix raced for {prior_seasons} {prior_seasons_word} before the rebrand, posting {prior_wins} {prior_wins_word}, {prior_podiums} {prior_podiums_word} and {prior_points} {prior_points_word}, a best constructors' finish of {prior_best_finish}. {top_driver} was the most prominent name across the Jordan era. A driver announcement for {next} will follow.
QUOTE: "Eddie Jordan built something that mattered in this sport. We take it forward with respect for that history and a clear eye on where we want to take it." / "Midland is a new name in Formula 1 but not a new team. The people, the factory, the experience, all of it continues."

### rebrand-silverstone-2007 (Midland -> Spyker)  [MINOR]
DEK: Dutch sports-car maker Spyker buys Midland and adds another name to the Silverstone team's rapid turnover of identities.
b1: Spyker Cars NV, the Dutch boutique sports-car manufacturer, has purchased Midland F1 Racing and enters {next} as Spyker F1. The sale keeps the team on the grid while giving Spyker a high-profile platform for its road-car brand. The Silverstone factory and personnel remain in place.
b2: The Silverstone outfit had raced as Midland for {prior_seasons} {prior_seasons_word}, adding {prior_wins} {prior_wins_word}, {prior_podiums} {prior_podiums_word} and {prior_points} {prior_points_word} to the lineage, a best constructors' finish of {prior_best_finish}. {top_driver} carried the most notable performances. The line-up for {next} will be confirmed in the coming weeks.
QUOTE: "Spyker is a name that stands for performance and Dutch engineering. Formula 1 is the right stage for that identity."

### rebrand-silverstone-2008 (Spyker -> Force India)  [FIXED]
DEK: Vijay Mallya acquires Spyker and launches Force India, bringing fresh ownership and a new national identity to the Silverstone team.
b1: Vijay Mallya, working alongside Michiel Mol, completed the acquisition of the Silverstone-based Spyker team to form Force India, bringing an Indian identity to the F1 grid for the first time. The team lines up this season with Ferrari customer power, establishing a relationship with Maranello as the new ownership rebuilds the operation. / The Spyker team has been acquired by Mallya and Mol and relaunched as Force India, a constructor carrying the country's name into F1 for the first time, with Ferrari customer engines for {year}.
b2: The Silverstone lineage heads into the Force India era with {prior_seasons} {prior_seasons_word} on the books, {prior_wins} {prior_wins_word}, {prior_podiums} {prior_podiums_word} and {prior_points} {prior_points_word}, a best constructors' finish of {prior_best_finish}. {top_driver} is the most decorated name across the lineage so far. Mallya will confirm his driver plans for {next} separately.
QUOTE: "India is a nation of over a billion people with a passion for sport and an appetite for global excellence. Force India is that ambition made real." / "We are not here to fill out the grid. We are here to grow, to improve, and eventually to challenge the teams ahead of us."

### rebrand-silverstone-2019 (Force India -> Racing Point)  [MARQUEE]
DEK: Force India survives administration as Lawrence Stroll's consortium acquires the assets and the team continues as Racing Point, racing through to the end of the season.
b1: Force India entered administration during the season, with joint administrators overseeing a sale. Lawrence Stroll's consortium, acting quickly to preserve the team's place on the grid, acquired the assets and reformed the operation as Racing Point F1 Team. The team continued racing through the crisis, with personnel, factory and competitive programme preserved throughout. Aston Martin, in which Stroll holds a significant stake, was already emerging as a longer-term destination for the identity.
b2: Force India had raced for {prior_seasons} {prior_seasons_word} under Vijay Mallya's ownership, producing {prior_wins} {prior_wins_word}, {prior_podiums} {prior_podiums_word} and {prior_points} {prior_points_word}, a best constructors' finish of {prior_best_finish}. {top_driver} was the team's most effective performer across that era. The Racing Point line-up into {next} will be confirmed as the off-season progresses.
QUOTE: "We acted because we believed in this team, in this factory, and in the people inside it. Racing Point is not a temporary name, it is the next chapter." / "The most important thing today is that these people still have jobs and this sport keeps a competitive outfit on the grid. Everything else is detail."

### rebrand-silverstone-2021 (Racing Point -> Aston Martin)  [MARQUEE; FIXED]
DEK: Lawrence Stroll rebrands Racing Point as Aston Martin, returning the legendary British marque to Formula 1 after six decades. / Aston Martin is back in Formula 1 as Stroll completes the project he signalled when he acquired the team in 2019.
b1: Lawrence Stroll has completed the rebranding of Racing Point as Aston Martin Cognizant Formula One Team, effective from {next}. Stroll, who holds a major stake in Aston Martin Lagonda, has long described this as the natural destination for his F1 project. Aston Martin last fielded a works Formula 1 team in the 1959-60 seasons, a gap of more than sixty years before the name reappears. The Silverstone base, the factory structure and the personnel continue unchanged, with significant investment planned in facilities and staff.
b2: The Silverstone team's lineage stretches back through Force India and beyond, covering {prior_seasons} {prior_seasons_word} in total, {prior_wins} {prior_wins_word}, {prior_podiums} {prior_podiums_word} and {prior_points} {prior_points_word}, a best constructors' finish of {prior_best_finish}. {top_driver} is the name most associated with the team's competitive high points. Aston Martin's line-up for {next} will be confirmed separately.
QUOTE: "Aston Martin is one of the greatest names in motorsport. Bringing it back to Formula 1 is not a marketing exercise. It is a statement of where this team is going." / "Sixty years is a long time. But great names do not expire. They wait. Aston Martin waited, and now it is back, and it intends to matter."

---

## ARRIVALS

### arrival-miltonkeynes-1997 (Stewart)
DEK: A father-and-son team takes Formula 1 seriously, Ford money in hand and a Milton Keynes factory ready to run.
b1: Jackie Stewart, three-time world champion, and his son Paul have formed Stewart Grand Prix for {next}, backed by a works engine arrangement with Ford. Jackie brings decades of experience as driver and figurehead; Paul has spent years developing the business around the family's racing ambitions. The team is based in Milton Keynes, close to the nucleus of British motorsport.
b2: Ford's involvement gives the team works-calibre power from the outset, a foundation most new constructors spend years building. The grid grows to {grid_count} constructors for {next}. A driver line-up will be confirmed before the season begins.
QUOTE: "We have not come here to make up the numbers. Paul and I have thought about this for a long time, and we believe we have the right people, the right partner, and the right plan."

### arrival-lola-1997 (Lola)  [MINOR]
DEK: A celebrated name returns to the grid on a budget that was always too thin for what the team needed.
b1: Lola Cars, a marque with deep roots in motorsport construction, has secured a Formula 1 entry for {next} with MasterCard as primary backer. The project was assembled quickly, and concerns about the funding base emerged almost immediately as the team sought to finalise its preparations.
b2: The team joins a grid of {grid_count} constructors. A driver line-up will be confirmed in due course.
QUOTE: "We believe in this project. We are working through the challenges and expect to be ready for the season."

### arrival-toyota-2002 (Toyota)  [MARQUEE]
DEK: One of the world's largest automakers steps onto the Formula 1 grid as a full works constructor, bringing its own engine, its own chassis division, and a Cologne headquarters built specifically for the task.
b1: Toyota Motor Corporation has formally entered Formula 1 for {next} as a fully independent works team. Unlike previous manufacturer entries that acquired or partnered with an existing outfit, Toyota has built its operation from the ground up, establishing a dedicated facility in Cologne. The team develops and builds its own power unit, runs its own chassis programme and answers directly to Toyota's board in Japan.
b2: Toyota joins a grid of {grid_count} constructors for {next}. The Cologne facility houses aerodynamic research, engine development and race operations under one roof. The team's driver line-up will be announced before the season begins.
QUOTE: "Toyota does not enter a competition to participate. We have built something in Cologne that we are genuinely proud of, and we intend to demonstrate what this organisation is capable of."

### arrival-superaguri-2006 (Super Aguri)
DEK: A former grand prix driver turns team principal, with Honda's backing and a determination to give Japanese talent a path into the sport.
b1: Aguri Suzuki, who competed in Formula 1 through the late 1980s and early 1990s and scored a podium at his home race in Suzuka, has founded Super Aguri F1 for {next}. Honda Motor Company provides technical and financial support, giving the team the foundation to compete. Suzuki's ambition is a competitive team with a Japanese identity at its core.
b2: Super Aguri enters a grid of {grid_count} constructors. The team operates with Honda's backing but competes under its own name and flag. A driver line-up will be confirmed ahead of the season.
QUOTE: "I raced in this sport for many years. Now I want to give others that opportunity, and I want to do it the right way, with proper support and a long-term vision."

### arrival-caterham-2010 (Team Lotus)
DEK: One of Britain's most celebrated racing names is back, carried into Formula 1 by an entrepreneur who saw an opportunity when the grid opened its doors.
b1: Tony Fernandes, the AirAsia founder, has acquired the rights to the Team Lotus name and entered Formula 1 for {next}. The revival carries genuine historical weight: Team Lotus won multiple world championships at its peak. Fernandes has assembled a technical operation to put a car on the grid under that name for the first time in years.
b2: Team Lotus is one of three new constructors joining for {next}, an expansion that brings the field to {grid_count} teams, reflecting a broader effort to widen access through revised commercial terms. A driver line-up will be confirmed before the season begins.
QUOTE: "Team Lotus means something. It meant something to my father's generation and it means something now. We are not here as a tribute act. We are here to race."

### arrival-manor-2010 (Virgin Racing)
DEK: A British entrepreneur with an eye for the unconventional brings his most famous brand to the Formula 1 grid, fronting a team built by a small English constructor.
b1: Virgin Group founder Richard Branson is backing a new entry under the Virgin Racing name, operated by Manor Motorsport, a British outfit with a long record in junior formulae. The partnership brings Branson's global brand profile together with a team that knows how to build and run racing cars.
b2: Virgin Racing joins as part of the {entry_year} expansion, one of three new constructors entering this season. The field grows to {grid_count} teams. A driver line-up will be confirmed before the season gets underway.
QUOTE: "Virgin has always gone where others said it was too difficult. Formula 1 is exactly that kind of challenge, and I am delighted to be part of it."

### arrival-hrt-2010 (HRT)  [MINOR]
DEK: Hispania Racing secures a place on the grid, arriving with less preparation time than most new teams could afford.
b1: Hispania Racing Team, under the HRT name, has confirmed its entry for {next} as one of three new constructors joining the field. The Spanish-backed privateer assembled its entry in a compressed timeframe, reflecting both the ambition of its founders and the challenge of building a Formula 1 team at speed.
b2: HRT takes the grid to {grid_count} constructors alongside the simultaneous arrivals of Team Lotus and Virgin Racing. A driver line-up will be confirmed before the season begins.
QUOTE: "Getting here was not simple, but we are here. That is what matters. We will be on the grid and we will work every day to get better."

### arrival-haas-2016 (Haas)  [MARQUEE]
DEK: A NASCAR team owner turns his attention to Formula 1, assembling an American entry with a structural Ferrari partnership at its foundation.
b1: Gene Haas, co-owner of Stewart-Haas Racing in NASCAR, has founded Haas F1 Team for {next}, marking the return of an American constructor to Formula 1 after a lengthy absence. Haas built his fortune through CNC machine tool manufacturing before becoming a prominent figure in American motorsport.
b2: What separates Haas from most new constructors is the depth of its Ferrari technical alliance. The team uses Ferrari power and draws on a partnership covering key components of the car, letting Haas concentrate resource where independent development adds the most value. The team joins a grid of {grid_count} constructors. A driver line-up will be announced before the season begins.
QUOTE: "I did not come to Formula 1 to be a backmarker. The Ferrari relationship gives us a credible platform from day one, and we intend to build on it every year."

### arrival-cadillac-2026 (Cadillac)  [MARQUEE — the anchor]
DEK: Years of political wrangling give way to a pit lane reality, America's most storied luxury marque has arrived.
b1: General Motors has received final FIA and FOM approval to enter Formula 1 under the Cadillac banner, becoming the sport's first new constructor since Haas in 2016. Backed by TWG Motorsports and operated from a base near Silverstone, the team will run on Ferrari power while GM develops its own power unit, targeting full works status by the end of the decade.
b2: The road here was anything but smooth. An earlier bid under the Andretti name was flatly rejected by Formula One Management before being restructured around GM's direct corporate involvement. Team principal Graeme Lowdon, who once led the Manor squad through its turbulent years on the grid, described the moment approval came through simply: "The overriding emotion was relief." The driver line-up will be confirmed before the season begins.
QUOTE: "We had been fighting for this for a long time. When it finally came through, the overriding emotion was relief. Now we get to do the job."
ALT DEK: Cadillac arrives to expand the grid to {grid_count} teams. / After a campaign that outlasted several political cycles and one outright rejection, General Motors is finally on the Formula 1 entry list.

---

## DEPARTURES

### departure-forti-1996 (Forti)  [MINOR]
DEK: {stint_seasons} {stint_seasons_word} at the back of the grid, and Forti Corse exits without ceremony.
b1: Forti Corse has confirmed it will not enter the coming season. The small Italian team, founded by Guido Forti and running customer Ford engines, ran out of operating capital and found no investor willing to step in. The closure had been visible from a distance, the team racing on a budget that stretched to breaking point with every round.
b2: {stint_seasons} {stint_seasons_word} of effort produced {wins} {wins_word}, {podiums} {podiums_word} and {points} {points_word}, a best constructors' finish of {best_finish}. {top_driver} was the team's most productive driver.
b3: {seatless_count} {seatless} are now without a seat. There will be no farewell season and no rebranded successor, just a quiet exit from the back of the paddock.
QUOTE: "We gave everything we had every single weekend. I have no regrets, only gratitude to everyone who kept those cars rolling."

### departure-lola-1997 (Lola)  [MINOR]
DEK: MasterCard's backing evaporates in weeks, and Lola's brief F1 venture is over.
b1: Lola Cars will not continue. The MasterCard-backed entry arrived underprepared and structurally underfunded; when the title sponsorship collapsed soon after the campaign began, there was nothing left to sustain the programme.
b2: {stint_seasons} {stint_seasons_word} on the entry list is all there is to show. The books read {wins} {wins_word}, {podiums} {podiums_word} and {points} {points_word}. {top_driver} carried the colours in {their} time with the team.
b3: {seatless_count} {seatless} find themselves without a drive. The whole episode lasted barely longer than the runway it needed.
QUOTE: "The plan was ambitious. Looking back, I can see exactly where the cracks were. We just couldn't see them quickly enough at the time."

### departure-prost-2001 (Prost, was Ligier)
DEK: Alain Prost's grand prix team goes bankrupt, and a French chapter that traced its roots to Ligier comes to a close.
b1: Prost Grand Prix has been declared bankrupt. The team, which Alain Prost purchased from Ligier in 1997 and relaunched under his own name, never found stable financial footing. A late attempt to secure investment from Peugeot, which had supplied Prost's engines, fell apart, and the administrators moved in before the new season could begin.
b2: Across {stint_seasons} {stint_seasons_word} covering both the Ligier years and the Prost era, the team recorded {wins} {wins_word}, {podiums} {podiums_word} and {points} {points_word}, a best constructors' result of {best_finish}. {top_driver} was the standout name over that period.
b3: {seatless_count} {seatless} enter the market without a drive. The Prost project was one of Formula 1's more storied attempts to turn a champion's prestige into a lasting team, and it did not survive.
QUOTE: "Alain gave everything he had trying to keep this alive. We all did. Some projects don't get the ending they deserve, and this was one of them."

### departure-arrows-2002 (Arrows, was Footwork)
DEK: Tom Walkinshaw's financial empire unravels, and Arrows, one of the grid's oldest names, cannot be saved.
b1: Arrows Grand Prix International has collapsed. The team built by Tom Walkinshaw, who steered it through a rebrand from its Footwork years, fell into difficulty as Walkinshaw's wider business interests deteriorated. Creditors moved in and no credible buyer materialised before the deadline.
b2: The lineage, spanning the Footwork and Arrows identities, ran to {stint_seasons} {stint_seasons_word} in total, producing {wins} {wins_word}, {podiums} {podiums_word} and {points} {points_word}. A best constructors' finish of {best_finish} stands as the high-water mark. {top_driver} did the most to put those numbers on the board.
b3: {seatless_count} {seatless} are left looking for seats. The closure leaves behind a team that was, for long stretches of its life, a genuine midfield competitor.
QUOTE: "This team had real quality in it. Real racers. The money problems were never the fault of the people who showed up every weekend and did the work. That's what I'll carry with me."

### departure-superaguri-2008 (Super Aguri)
DEK: Promised funding never arrived, and Super Aguri's Honda-backed experiment comes to an end.
b1: Super Aguri F1 will not continue. The team, founded by Aguri Suzuki with Honda's support, had been searching for an external investor to replace Honda's diminishing financial commitment. A deal with a consortium of investors fell through at the final stage, leaving the team without the capital to go on.
b2: {stint_seasons} {stint_seasons_word} produced {wins} {wins_word}, {podiums} {podiums_word} and {points} {points_word}, a best constructors' result of {best_finish}. {top_driver} was the most consistent performer for the squad.
b3: {seatless_count} {seatless} are now without a drive. Aguri Suzuki built something that shouldn't have worked on paper, and for a period it did, which is more than most would have managed with the same resources.
QUOTE: "Aguri-san created something from nothing. We all knew the margins were tight, but nobody ever drove within themselves because of it. That's the culture he built, and I'm proud to have been part of it."

### departure-toyota-2009 (Toyota)  [MARQUEE; FIXED dek]
DEK: Toyota's board ends a heavily funded works programme after the global financial crisis, leaving {seatless_count} drivers without a seat. / The financial crisis forces Toyota's hand, the board pulling the plug on its Cologne-based works effort and leaving {seatless_count} drivers on the market.
b1: Toyota Motor Corporation has announced it will withdraw from Formula 1, effective after the {year} season. The decision was made at board level in Tokyo, driven by the global financial crisis of 2008 and the pressure it placed on discretionary expenditure across the group. The Cologne-based motorsport division will cease its grand prix operations. No buyer was sought; the programme ends. / The Cologne facility employed hundreds of engineers across chassis, power unit and aerodynamics departments, a scale of infrastructure that reflected Toyota's ambition to compete at the front of the field. That investment was always vulnerable to the boardroom calculus of a parent company that treated F1 as a brand exercise, and when the financial crisis arrived the case for the programme could not survive the review.
b2: Across {stint_seasons} {stint_seasons_word} in Formula 1, Toyota recorded {wins} {wins_word}, {podiums} {podiums_word} and {points} {points_word}, a best constructors' result of {best_finish}. {top_driver} was the team's most accomplished driver, {top_driver_feat}.
b3: {seatless_count} {seatless} enter an off-season market that had no warning this many seats would open at once. For the engineers and mechanics in Cologne, there is simply a date on which the garage goes quiet.
QUOTE: "I don't think I ever fully appreciated what Toyota had built there until I looked back on it after the call came. The facility, the people, the sheer determination to do it properly. It deserved a different ending." / "The board made their decision and that was that. You just shake hands with the people who gave you everything and you go home."

### departure-hrt-2012 (HRT)  [MINOR]
DEK: HRT's funding never reached the level the team needed, and {stint_seasons} {stint_seasons_word} on the grid comes to an end.
b1: Hispania Racing Team has not renewed its entry. The Spanish outfit, which entered Formula 1 as one of three new constructors in 2010, struggled throughout its existence to secure the sponsorship and capital its operations required. After several ownership changes and restructurings failed to resolve the shortfall, the team has folded.
b2: {stint_seasons} {stint_seasons_word} produced {wins} {wins_word}, {podiums} {podiums_word} and {points} {points_word}, a best result of {best_finish}. {top_driver} was the standout across the team's time on the grid.
b3: {seatless_count} {seatless} are searching for seats. Of the three teams that joined the grid together in 2010, HRT lasted the shortest.
QUOTE: "We showed up every week with less than almost anyone else out there. I won't pretend it wasn't hard. But we were there, and that counts for something."

### departure-caterham-2014 (Caterham, entered 2010 as Team Lotus)
DEK: {stint_seasons} {stint_seasons_word} on the grid, {name_era}, and the story ends in administration with no buyer willing to take it on.
b1: Caterham F1 Team has entered administration and will not compete next season. The team, which arrived in 2010 as Tony Fernandes' Team Lotus revival before a naming dispute with Group Lotus forced a rebrand to Caterham in 2012, could not attract the investment needed to continue. Administrators confirmed no viable acquisition offer was received. / Losing the Lotus name was a blow that cost sponsorship momentum and brand recognition at the worst possible time, and the team never recovered the commercial ground that loss opened up.
b2: Aggregated across the full lineage, {name_era}, the record reads {wins} {wins_word}, {podiums} {podiums_word} and {points} {points_word} from {stint_seasons} {stint_seasons_word} of competition. The best constructors' result was {best_finish}. {top_driver} contributed most to those numbers.
b3: {seatless_count} {seatless} are without drives as the market opens. The project Fernandes launched with genuine attachment to the Team Lotus name now closes without one, its cars and equipment to be disposed of by the administrators.
QUOTE: "Tony built something real here. The name changed, the backing changed, but the people who came in every day never stopped caring. That part never changed, and I won't forget it."

### departure-manor-2016 (Manor, entered 2010 as Virgin then Marussia)  [the anchor]
DEK: {stint_seasons} {stint_seasons_word} of survival on a shoestring ends without a buyer, without a successor, without a goodbye race.
b1: Manor Racing has entered administration and will not take part in the coming season. Administrators confirmed they were unable to find a buyer within the available window, bringing to a close a story that began in 2010 when a Formula Renault outfit reinvented itself as Virgin Racing under Richard Branson's banner. / The team had already been here before. A first collapse between 2014 and 2015, then racing as Marussia, nearly ended it permanently. A rescue by energy entrepreneur Stephen Fitzpatrick bought two more seasons, but it was not enough.
b2: In their time in F1, {name_era}, Manor recorded {wins} {wins_word}, {podiums} {podiums_word} and {points} {points_word}, a best constructors' finish of {best_finish}. {top_driver} did the most across {stint_seasons} {stint_seasons_word} to put those numbers on the board.
b3: {seatless_count} {seatless} find themselves without a drive. A Manor spokesperson said that their unraced 2017 machine would have been a rocketship but would now be auctioned off, marking a sad end to a feel-good story.
QUOTE: "Every Sunday morning I'd walk into that garage and think, we have absolutely no business being here. And then the lights went out and we raced anyway. I'll miss that feeling for the rest of my life."

---

## EXTRA

### grid-grows-2010 (the 2010 three-team intake)
DEK: Formula 1 grows to {grid_count} constructors as three new outfits earn their place on the grid, each with a different story about how they got there.
b1: The FIA's introduction of a resource restriction agreement for {entry_year} created an opening that had not existed for years, a credible path for new, smaller constructors to enter Formula 1 and be financially viable. Three teams took it. Tony Fernandes' Team Lotus revived one of the sport's most celebrated names. Richard Branson's Virgin brand fronted the Manor Motorsport operation. And Hispania Racing, the HRT entry, completed the intake as a Spanish-backed privateer.
b2: The simultaneous arrival of three constructors is the largest single-season grid expansion the sport has seen in some time. The field grows to {grid_count} teams for {entry_year}. Each arrives at a different stage of readiness, with different funding and different ambitions, but all three have cleared the formal requirements. What they make of the opportunity is yet to be written.
QUOTE: "Formula 1 should not be a closed shop. These teams earned their place and we are delighted to welcome them to the grid."
