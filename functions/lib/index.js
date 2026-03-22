"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.monthlySummaryEmail = exports.parseStatement = exports.scenarioSummary = exports.netWorthSnapshot = exports.revenuecatWebhook = exports.plaidDone = exports.plaidSyncTransactions = exports.plaidExchangeToken = exports.plaidLink = exports.plaidLinkToken = exports.chat = void 0;
const admin = __importStar(require("firebase-admin"));
// Initialize Firebase Admin once at module load
if (!admin.apps.length) {
    admin.initializeApp();
}
var chat_1 = require("./chat");
Object.defineProperty(exports, "chat", { enumerable: true, get: function () { return chat_1.chat; } });
var plaid_1 = require("./plaid");
Object.defineProperty(exports, "plaidLinkToken", { enumerable: true, get: function () { return plaid_1.plaidLinkToken; } });
Object.defineProperty(exports, "plaidLink", { enumerable: true, get: function () { return plaid_1.plaidLink; } });
Object.defineProperty(exports, "plaidExchangeToken", { enumerable: true, get: function () { return plaid_1.plaidExchangeToken; } });
Object.defineProperty(exports, "plaidSyncTransactions", { enumerable: true, get: function () { return plaid_1.plaidSyncTransactions; } });
Object.defineProperty(exports, "plaidDone", { enumerable: true, get: function () { return plaid_1.plaidDone; } });
var revenuecat_1 = require("./revenuecat");
Object.defineProperty(exports, "revenuecatWebhook", { enumerable: true, get: function () { return revenuecat_1.revenuecatWebhook; } });
var netWorthSnapshot_1 = require("./netWorthSnapshot");
Object.defineProperty(exports, "netWorthSnapshot", { enumerable: true, get: function () { return netWorthSnapshot_1.netWorthSnapshot; } });
var scenarioSummary_1 = require("./scenarioSummary");
Object.defineProperty(exports, "scenarioSummary", { enumerable: true, get: function () { return scenarioSummary_1.scenarioSummary; } });
var parseStatement_1 = require("./parseStatement");
Object.defineProperty(exports, "parseStatement", { enumerable: true, get: function () { return parseStatement_1.parseStatement; } });
var monthlySummaryEmail_1 = require("./monthlySummaryEmail");
Object.defineProperty(exports, "monthlySummaryEmail", { enumerable: true, get: function () { return monthlySummaryEmail_1.monthlySummaryEmail; } });
//# sourceMappingURL=index.js.map