import { Router, type IRouter } from "express";
import healthRouter from "./health";
import tradesRouter from "./trades";
import eventsRouter from "./events";
import researchRouter from "./research";
import dailyfeedRouter from "./dailyfeed";
import discussionsRouter from "./discussions";
import dashboardRouter from "./dashboard";
import watchlistRouter from "./watchlist";
import playbookRouter from "./playbook";
import playbookTodayRouter from "./playbook-today";
import playbookSpacesRouter from "./playbook-spaces";
import { forgetOfficeSetups } from "../lib/tradesSetupLink";
import activityRouter from "./activity";
import errorsRouter from "./errors";
import big7levelsRouter from "./big7levels";
import big7catalystsRouter from "./big7catalysts";
import big7tickersRouter from "./big7tickers";
import ratingsRouter from "./ratings";
import usersRouter from "./users";
import onboardingRouter from "./onboarding";
import appErrorsRouter from "./app-errors";
import adminSettingsRouter from "./admin-settings";
import stockdataRouter from "./stockdata";
import newsRouter from "./news";
import sectorsRouter from "./sectors";
import holidaysRouter from "./holidays";
import marketBriefRouter from "./marketbrief";
import marketConditionsRouter from "./marketconditions";
import tradeIdeasRouter from "./tradeideas";
import aireviewRouter from "./aireview";
import aibatchRouter from "./aibatch";
import mentorRouter from "./mentor";
import aiAssistantRouter from "./ai-assistant";
import emotionalstateRouter from "./emotionalstate";
import voicenotesRouter from "./voicenotes";
import psychologyanalyticsRouter from "./psychologyanalytics";
import weeklyPsychologyReportRouter from "./weeklypsychologyreport";
import candlesRouter from "./candles";
import executionsRouter from "./executions";
import analystActionsRouter from "./analyst-actions";
import dailyQuotesRouter from "./dailyQuotes";
import quotesRouter from "./quotes";
import leaderboardRouter from "./leaderboard";
import rulesRouter from "./rules";
import adminRouter from "./admin";
import authRouter from "./auth";
import screenLockRouter from "./screen-lock";
import fxRouter from "./fx";
import earningsRouter from "./earnings";
import authorNotesRouter from "./author-notes";
import juniorNotesRouter from "./junior-notes";
import telegramRouter from "./telegram";
import ideaCommentsRouter from "./idea-comments";
import notificationsRouter from "./notifications";
import optionsRouter from "./options";
import offeringsRouter from "./offerings";
import journalRouter from "./journal";
import riskRouter from "./risk";
import gamePlanRouter from "./gameplan";
import planMediaRouter from "./plan-media";
import propreportsRouter from "./propreports";
import cronRouter from "./cron";
import propreportsTickRouter from "./propreports-tick";
import { tradesVersionMiddleware } from "../lib/propreports/tradesVersion";
import { sectionAccessMiddleware } from "../lib/access/sections";
import { setting } from "../lib/settings/registry";
import { notFound } from "../lib/http";
import tradeQualityRouter from "./trade-quality";
import scalingRouter from "./scaling";
import weeklyReviewRouter from "./weekly-review";
import eodRouter from "./eod";
import edgeRouter from "./edge";
import myEdgeRouter from "./my-edge";
import marketRegimeRouter from "./market-regime";
import catalystsRouter from "./catalysts";
import analystSignalsRouter from "./analyst-signals";
import corpEventsRouter from "./corp-events";
import analoguesRouter from "./analogues";
import podsRouter from "./pods";
import leakGuardRouter from "./leak-guard";
import capitalRouter from "./capital";
import profileRouter from "./profile";
import juniorCostRouter from "./junior-cost";
import statsAggregateRouter from "./stats-aggregate";
import permissionsRouter from "./permissions";
import whatifRouter from "./whatif";
import behaviorRouter from "./behavior";
import setupsAutoRouter from "./setups-auto";
import dayReportRouter from "./day-report";
import benchmarkRouter from "./benchmark";
import reconcileRouter from "./reconcile";
import propreportsAccuracyRouter from "./propreports-accuracy";
import propreportsApiRouter from "./propreports-api";
import indicatorNotesRouter from "./indicator-notes";
import academyPathRouter from "./academy-path";
import academyCohortsRouter from "./academy-cohorts";
import academyContentRouter from "./academy-content";
import adminConsoleRouter from "./admin-console";
import curatorRouter from "./curator";
import curatorRequestsRouter from "./curator-requests";
import deskGroupsRouter from "./desk-groups";
import trainingRouter from "./training";
import simRouter from "./sim";
import trainerRouter from "./trainer";
import chartDrawingsRouter from "./chart-drawings";
import chartLabRouter from "./chart-lab";
import officeStatsRouter from "./officeStats";
import officeRecsRouter from "./officeRecs";
import askRouter from "./ask";
import dailyRouter from "./daily";
import dayStateRouter from "./day-state";
import deskDayRouter from "./deskDay";
import topRouter from "./top";
import questsRouter from "./quests";
import gamificationRouter from "./gamification";
import myReviewRouter from "./my-review";
import coachRouter from "./coach";
import usageRouter from "./usage";
import finvizRouter from "./finviz";
import themesRouter from "./themes";
import themesBoardsRouter from "./themes-boards";
import newsChannelRouter from "./news-channel";

const router: IRouter = Router();

router.use(healthRouter);
router.use(cronRouter); // POST|GET /cron/tick — PropReports heartbeat (Bearer CRON_SECRET)
router.use(tradesVersionMiddleware); // cross-instance trade-cache stamp (≤ 1 SELECT / 15 s / instance)
// Sections closed per ladder stage (desk setting access.sections, default {} = open): 403 SECTION_BLOCKED, staff never.
router.use(sectionAccessMiddleware);
router.use(tradeQualityRouter);
router.use(tradesRouter);
router.use(eventsRouter);
router.use(corpEventsRouter); // corporate and index events: desk entries, rule dates, offerings feed, S&P headlines
router.use(researchRouter);
router.use(dailyfeedRouter);
router.use(discussionsRouter);
router.use(dashboardRouter);
router.use(watchlistRouter);
// Any successful playbook write (create, rename, move to the office space, delete) drops the 60 s office-setups memo, so
// a trade tagged with a setup made a moment ago links to it (lib/tradesSetupLink).
router.use("/playbook", (req, res, next) => {
  if (req.method !== "GET") res.on("finish", () => { if (res.statusCode < 400) forgetOfficeSetups(); });
  next();
});
router.use(playbookTodayRouter); // before playbookRouter: /playbook/today is not a setup id
router.use(analoguesRouter); // playbook cases, «похожие прошлые случаи», the academy quiz «на что похоже»
router.use(playbookRouter);
router.use(playbookSpacesRouter);
router.use(activityRouter);
router.use(errorsRouter);
router.use(big7levelsRouter);
router.use(big7catalystsRouter);
router.use(big7tickersRouter);
router.use(ratingsRouter);
router.use(usersRouter);
router.use(onboardingRouter);
router.use(appErrorsRouter);
router.use(adminSettingsRouter);
router.use(stockdataRouter);
router.use(newsRouter);
router.use(sectorsRouter);
router.use(holidaysRouter);
router.use(marketBriefRouter);
router.use(marketConditionsRouter);
router.use(tradeIdeasRouter);
router.use(aireviewRouter);
router.use(aibatchRouter);
router.use(mentorRouter); // AI mentor: memory, daily rhythm, commitments, escalation (lib/mentor)
router.use(aiAssistantRouter); // «Ассистент WS» (docs/AI_ASSISTANT.md)
router.use(emotionalstateRouter);
router.use(voicenotesRouter);
router.use(psychologyanalyticsRouter);
router.use(weeklyPsychologyReportRouter);
router.use(candlesRouter);
router.use(executionsRouter);
router.use(analystSignalsRouter); // before /analyst-actions: catalyst strength from analyst clusters / big target changes
router.use(analystActionsRouter);
router.use(dailyQuotesRouter);
router.use(quotesRouter);
router.use(leaderboardRouter);
router.use(rulesRouter);
router.use(adminRouter);
router.use(authRouter);
router.use(screenLockRouter); // «Заблокировать»: /auth/lock, /auth/unlock, /auth/quick-code
router.use(fxRouter);
router.use(earningsRouter);
// «Сводка автора» is behind the desk switch nav.authorNotes (default off, Волна 2 п. 2.15): off → every route 404.
router.use("/author-notes", (_req, _res, next) => next(setting("nav.authorNotes") ? undefined : notFound()));
router.use(authorNotesRouter);
router.use(juniorNotesRouter);
router.use(telegramRouter);
router.use(ideaCommentsRouter);
router.use(notificationsRouter);
router.use(optionsRouter);
router.use(offeringsRouter);
router.use(journalRouter);
router.use(riskRouter);
router.use(gamePlanRouter);
router.use(planMediaRouter);
router.use(propreportsRouter);
router.use(propreportsTickRouter);
router.use(scalingRouter);
router.use(weeklyReviewRouter);
router.use(eodRouter);
router.use(edgeRouter);
router.use(myEdgeRouter); // «Мой edge и рынок» (analytics)
router.use(marketRegimeRouter); // desk market regime: day, limit multiplier, playbook tags, edge by regime, reflection
router.use(catalystsRouter); // catalyst direction × strength: plan / watchlist taps, suggestions, the analytics slice
router.use(leakGuardRouter); // live leak guard: active pauses, acknowledgement, impact in $, desk, levels
router.use(capitalRouter); // capital allocation: risk moves to proven edge (lib/capital), proposals in the scaling queue
router.use(profileRouter); // «Профиль»: scouting card, biography, analytics (GET /profile/me, /profile/:id)
router.use(juniorCostRouter); // «Цена джуна до безубытка»: own / ward path, staff desk view (cohorts, «что окупается»)
router.use(statsAggregateRouter); // GET /stats/aggregate — staff /stats and /analytics without raw trades
router.use(permissionsRouter);
router.use(whatifRouter);
router.use(behaviorRouter);
router.use(setupsAutoRouter);
router.use(dayReportRouter);
router.use(benchmarkRouter);
router.use(reconcileRouter);
router.use(propreportsAccuracyRouter);
router.use(propreportsApiRouter);
router.use(indicatorNotesRouter);
router.use(academyPathRouter);
router.use(academyCohortsRouter);
router.use(academyContentRouter);
router.use(adminConsoleRouter);
router.use(curatorRouter);
router.use(curatorRequestsRouter);
router.use(deskGroupsRouter);
router.use(podsRouter); // trading pods inside a curator's group: shared stats, feed, weekly review
router.use(trainingRouter);
router.use(simRouter);
router.use(trainerRouter);
router.use(chartDrawingsRouter);
router.use(chartLabRouter);
router.use(officeStatsRouter);
router.use(officeRecsRouter);
router.use(askRouter);
router.use(dailyRouter);
router.use(dayStateRouter); // the trader's day state: /me/state, /state/team, /state/message (lib/dayState)
router.use(deskDayRouter);
router.use(topRouter);
router.use(questsRouter);
router.use(gamificationRouter);
router.use(myReviewRouter); // GET /my-review — the trader's own review digest
router.use(coachRouter); // coaching evidence: interventions log (R9a), edge map (R4), plateau (R6)
router.use(usageRouter);
router.use(finvizRouter); // Finviz Elite: screener, ticker snapshot, earnings calendar (lib/finviz)
router.use(themesRouter); // «Темы рынка»: theme tracker (lib/themes)
router.use(themesBoardsRouter); // «Темы рынка»: personal boards (lib/themes/board*)
router.use(newsChannelRouter); // WS_NEWS channel briefs: admin preview / send-now (lib/newsChannel)

// Last: an /api path no router answered is a JSON 404 (removed routes included), never Express's HTML page or, in
// production, the SPA's index.html.
router.use((_req, _res, next) => next(notFound()));

export default router;
