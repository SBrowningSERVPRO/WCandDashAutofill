// ==UserScript==
// @name         WorkCenter + CreateJob Intake Autofill (Phase 21.2)
// @namespace    http://tampermonkey.net/
// @version      21.2
// @description  Combined autofill with load-on-demand RadComboBox support, Division checkboxes, Insurance Carrier, Claim/Policy, Loss Description
// @match        https://workcenter-sp.servpronet.io/intake*
// @match        https://servpro.ngsapps.net/Enterprise/Module/Job/CreateJob.aspx*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    // ==========================================
    //  FIXED COLUMN INDICES (shared data key format)
    // ==========================================
    const COLUMN = {
        Id: 0,
        StartTime: 1,
        CompletionTime: 2,
        Email: 3,
        Name: 4,
        Initials: 5,
        CallerName: 6,                          // POC Name
        PropertyType: 7,                        // Residential or Commercial
        BusinessName: 8,                        // Commercial Business Name
        ReportedBy: 9,                          // POC's Affiliation
        LossAddress: 10,
        BillingAddress: 11,
        AdditionalPhone: 12,
        Phone: 13,                              // Phone Number
        SecondaryEmail: 14,
        Email_Field: 15,                        // Email Address
        TypeOfLoss: 16,
        DateOfLoss: 17,
        CauseOfLoss: 18,                        // Cause of Loss/Has it been resolved
        AffectedAreas: 19,
        AdditionalDetails: 20,
        YearBuilt: 21,
        ReferredBy: 22,                          // How did you hear about Servpro?
        ConcreteOrCrawl: 23,
        SelfPayOrIns: 24,
        InsuranceCarrier: 25,
        ClaimNum: 26,
        PolicyNum: 27,
        InsuranceAgentAdjuster: 28,
        ServproHQRef: 29,
        MarketingRep: 30,
        EnvironmentalCode: 31,
        IsEmergency: 32,
        ScheduledPM: 33,                        // Scheduled PM Name
        ArrivalDate: 34,
        ArrivalTime: 35,                        // Arrival Time Window
        PerCustomerRequest: 36,
        Confirmed: 37,
        SpecialInstructions: 38,
        DepositRequired: 39,
        ScheduledPMFor: 40,
        DepositPaymentMethod: 41,
        GeneratedFNOL: 42,
        Notes: 43
    };

async function fetchEstimatorBatch(text) {
    const res = await fetch("https://servpro.ngsapps.net/Enterprise/Module/SearchAssist/ProductService.asmx/GetProviderEmployee", {
        headers: {
            "accept": "*/*",
            "content-type": "application/json; charset=UTF-8",
            "x-requested-with": "XMLHttpRequest"
        },
        referrer: location.href,
        body: JSON.stringify({ context: { Text: text, NumberOfItems: 0 } }),
        method: "POST",
        mode: "cors",
        credentials: "include"
    });
    const json = await res.json();
    let payload = json.d;
    if (typeof payload === "string") payload = JSON.parse(payload);
    return (payload && payload.Items) || [];
}

    async function fetchCustomerBatch(text) {
    const res = await fetch("https://servpro.ngsapps.net/Enterprise/Module/Services/DropDownsService.asmx/GetCustomerMultiColumn", {
        headers: {
            "accept": "*/*",
            "content-type": "application/json; charset=UTF-8",
            "x-requested-with": "XMLHttpRequest"
        },
        referrer: location.href,
        body: JSON.stringify({ context: { Text: text, NumberOfItems: 0 } }),
        method: "POST",
        mode: "cors",
        credentials: "include"
    });
    const json = await res.json();
    let payload = json.d;
    if (typeof payload === "string") payload = JSON.parse(payload);
    return (payload && payload.Items) || [];
}

    async function fetchCompanyCustomerBatch(text) {
    try {
        const res = await fetch("https://servpro.ngsapps.net/Enterprise/Module/Services/DropDownsService.asmx/GetCompanyCustomerMultiColumn", {
            headers: { "accept": "*/*", "content-type": "application/json; charset=UTF-8", "x-requested-with": "XMLHttpRequest" },
            referrer: location.href,
            body: JSON.stringify({ context: { Text: text, NumberOfItems: 0 } }),
            method: "POST", mode: "cors", credentials: "include"
        });
        const json = await res.json();
        let payload = json.d;
        if (typeof payload === "string") payload = JSON.parse(payload);
        return (payload && payload.Items) || [];
    } catch (e) {
        console.log("fetchCompanyCustomerBatch error:", e.message);
        return [];
    }
}

async function findCompanyCustomerByAddress(parsedAddr) {
    let street = (parsedAddr.street || "").toLowerCase().trim();
    let zip = (parsedAddr.zip || "").trim();
    if (!street) return null;
    let items = await fetchCompanyCustomerBatch(parsedAddr.street);
    if (!items.length) return null;
    for (let item of items) {
        let addr = ((item.Attributes && item.Attributes.Address) || "").toLowerCase();
        if (street && addr.includes(street) && (!zip || addr.includes(zip))) return item;
    }
    for (let item of items) {
        let addr = ((item.Attributes && item.Attributes.Address) || "").toLowerCase();
        if (street && addr.includes(street)) return item;
    }
    return null;
}

// Find an existing customer whose address matches the parsed billing/loss address.
// Returns the matching item { Text, Value, Attributes } or null.
async function findCustomerByAddress(parsedAddr) {
    let street = (parsedAddr.street || "").toLowerCase().trim();
    let zip = (parsedAddr.zip || "").trim();
    if (!street) return null;

    // Search by the full street line first (most distinctive)
    let items = await fetchCustomerBatch(parsedAddr.street);

    // Retry with house number + first street word if the full line over-filters
    if (!items.length) {
        let firstTokens = parsedAddr.street.split(/\s+/).slice(0, 2).join(" ");
        if (firstTokens && firstTokens !== parsedAddr.street) {
            items = await fetchCustomerBatch(firstTokens);
        }
    }
    if (!items.length) return null;

    // 1. Strict: street AND zip both present in the item's address
    for (let item of items) {
        let addr = ((item.Attributes && item.Attributes.Address) || "").toLowerCase();
        if (street && addr.includes(street) && (!zip || addr.includes(zip))) return item;
    }
    // 2. Looser: street line matches (no zip confirmation)
    for (let item of items) {
        let addr = ((item.Attributes && item.Attributes.Address) || "").toLowerCase();
        if (street && addr.includes(street)) return item;
    }
    return null;
}

async function findEstimatorMatch(scheduledPMRaw) {
    if (!scheduledPMRaw || scheduledPMRaw === "**NOT ASSIGNED**") return null;
    let raw = scheduledPMRaw.trim();
    if (!raw) return null;

    let parts = raw.split(/\s+/);
    let lastName = parts[parts.length - 1];
    let firstName = parts.length >= 2 ? parts.slice(0, -1).join(" ") : "";

    let lastLower = lastName.toLowerCase();
    let firstLower = firstName.toLowerCase();

    // Try last name, then first name, then the whole raw string
    let candidates = [lastName, firstName, raw].filter(Boolean);

    for (let candidate of candidates) {
        let items = await fetchEstimatorBatch(candidate);
        if (!items.length) continue;

        // Strict: "Last, First..." where Last matches exactly and First starts with our first name
        for (let item of items) {
            let [itemLast, itemFirst] = item.Text.toLowerCase().split(",").map(s => (s || "").trim());
            if (itemLast === lastLower && itemFirst && firstLower && itemFirst.startsWith(firstLower)) {
                return item;
            }
        }
        // Looser: text contains both name parts somewhere
        if (firstLower) {
            for (let item of items) {
                let t = item.Text.toLowerCase();
                if (t.includes(lastLower) && t.includes(firstLower)) return item;
            }
        }
        await new Promise(r => setTimeout(r, 100));
    }
    return null;
}

    // --- Zip to Franchise Mapping (raw WC FranchiseDD values) ---
    const zipToFranchiseMap = {"23002": "Chesterfield (C) 5248", "23112": "Chesterfield (C) 5248", "23113": "Chesterfield (C) 5248", "23114": "Chesterfield (C) 5248", "23120": "Chesterfield (C) 5248", "23139": "Chesterfield (C) 5248", "23234": "Chesterfield (C) 5248", "23235": "Chesterfield (C) 5248", "23236": "Chesterfield (C) 5248", "23237": "Chesterfield (C) 5248", "23831": "Chesterfield (C) 5248", "23832": "Chesterfield (C) 5248", "23836": "Chesterfield (C) 5248", "23838": "Chesterfield (C) 5248", "Chesterfield (PSP Franchise # 750273)": "Chesterfield (C) 5248", "23173": "Richmond (R) 10313", "23218": "Richmond (R) 10313", "23219": "Richmond (R) 10313", "23220": "Richmond (R) 10313", "23221": "Richmond (R) 10313", "23222": "Richmond (R) 10313", "23223": "Richmond (R) 10313", "23224": "Richmond (R) 10313", "23225": "Richmond (R) 10313", "23232": "Richmond (R) 10313", "23240": "Richmond (R) 10313", "23241": "Richmond (R) 10313", "23249": "Richmond (R) 10313", "23260": "Richmond (R) 10313", "23261": "Richmond (R) 10313", "23284": "Richmond (R) 10313", "23285": "Richmond (R) 10313", "23298": "Richmond (R) 10313", "23058": "Henrico (H) 10314", "23059": "Henrico (H) 10314", "23060": "Henrico (H) 10314", "23075": "Henrico (H) 10314", "23111": "Henrico (H) 10314", "23150": "Henrico (H) 10314", "23226": "Henrico (H) 10314", "23227": "Henrico (H) 10314", "23228": "Henrico (H) 10314", "23229": "Henrico (H) 10314", "23230": "Henrico (H) 10314", "23231": "Henrico (H) 10314", "23233": "Henrico (H) 10314", "23238": "Henrico (H) 10314", "23242": "Henrico (H) 10314", "23250": "Henrico (H) 10314", "23255": "Henrico (H) 10314", "23294": "Henrico (H) 10314", "23801": "Tri-Cities (T) 8510", "23803": "Tri-Cities (T) 8510", "23804": "Tri-Cities (T) 8510", "23805": "Tri-Cities (T) 8510", "23806": "Tri-Cities (T) 8510", "23825": "Tri-Cities (T) 8510", "23830": "Tri-Cities (T) 8510", "23833": "Tri-Cities (T) 8510", "23834": "Tri-Cities (T) 8510", "23840": "Tri-Cities (T) 8510", "23841": "Tri-Cities (T) 8510", "23842": "Tri-Cities (T) 8510", "23850": "Tri-Cities (T) 8510", "23860": "Tri-Cities (T) 8510", "23872": "Tri-Cities (T) 8510", "23875": "Tri-Cities (T) 8510", "23882": "Tri-Cities (T) 8510", "23885": "Tri-Cities (T) 8510", "23894": "Tri-Cities (T) 8510", "23321": "Chesapeake N (CN) 11281", "23322": "Chesapeake N (CN) 11281", "23323": "Chesapeake N (CN) 11281", "23324": "Chesapeake N (CN) 11281", "23326": "Chesapeake N (CN) 11281", "23327": "Chesapeake N (CN) 11281", "23325": "Chesapeake N (CN) 11281", "23328": "Chesapeake N (CN) 11281", "Chesapeake S (CS)": "Chesapeake N (CN) 11281", "11284": "Chesapeake N (CN) 11281", "23320": "Chesapeake N (CN) 11281", "Chesapeake (PSP Franchise # 601296)": "Chesapeake N (CN) 11281", "23651": "Hampton North (HN) 11282", "23661": "Hampton North (HN) 11282", "23662": "Hampton North (HN) 11282", "23663": "Hampton North (HN) 11282", "23665": "Hampton North (HN) 11282", "23666": "Hampton North (HN) 11282", "23664": "Hampton North (HN) 11282", "23667": "Hampton North (HN) 11282", "23668": "Hampton North (HN) 11282", "23669": "Hampton North (HN) 11282", "23670": "Hampton North (HN) 11282", "23681": "Hampton North (HN) 11282", "23501": "Norfolk (N) 11593", "23502": "Norfolk (N) 11593", "23503": "Norfolk (N) 11593", "23504": "Norfolk (N) 11593", "23506": "Norfolk (N) 11593", "23507": "Norfolk (N) 11593", "23505": "Norfolk (N) 11593", "23508": "Norfolk (N) 11593", "23509": "Norfolk (N) 11593", "23510": "Norfolk (N) 11593", "23511": "Norfolk (N) 11593", "23513": "Norfolk (N) 11593", "23514": "Norfolk (N) 11593", "23517": "Norfolk (N) 11593", "23518": "Norfolk (N) 11593", "23519": "Norfolk (N) 11593", "23520": "Norfolk (N) 11593", "23521": "Norfolk (N) 11593", "23523": "Norfolk (N) 11593", "23529": "Norfolk (N) 11593", "23541": "Norfolk (N) 11593", "23551": "Norfolk (N) 11593", "23701": "Portsmouth (P) 11594", "23702": "Portsmouth (P) 11594", "23703": "Portsmouth (P) 11594", "23704": "Portsmouth (P) 11594", "23707": "Portsmouth (P) 11594", "23708": "Portsmouth (P) 11594", "23705": "Portsmouth (P) 11594", "23709": "Portsmouth (P) 11594", "27906": "Elizabeth City/OBX (EC) 11283", "27907": "Elizabeth City/OBX (EC) 11283", "27909": "Elizabeth City/OBX (EC) 11283", "27915": "Elizabeth City/OBX (EC) 11283", "27917": "Elizabeth City/OBX (EC) 11283", "27919": "Elizabeth City/OBX (EC) 11283", "27916": "Elizabeth City/OBX (EC) 11283", "27920": "Elizabeth City/OBX (EC) 11283", "27921": "Elizabeth City/OBX (EC) 11283", "27923": "Elizabeth City/OBX (EC) 11283", "27926": "Elizabeth City/OBX (EC) 11283", "27927": "Elizabeth City/OBX (EC) 11283", "27929": "Elizabeth City/OBX (EC) 11283", "27932": "Elizabeth City/OBX (EC) 11283", "27935": "Elizabeth City/OBX (EC) 11283", "27936": "Elizabeth City/OBX (EC) 11283", "27937": "Elizabeth City/OBX (EC) 11283", "27938": "Elizabeth City/OBX (EC) 11283", "27939": "Elizabeth City/OBX (EC) 11283", "27941": "Elizabeth City/OBX (EC) 11283", "27946": "Elizabeth City/OBX (EC) 11283", "27943": "Elizabeth City/OBX (EC) 11283", "27944": "Elizabeth City/OBX (EC) 11283", "27947": "Elizabeth City/OBX (EC) 11283", "27948": "Elizabeth City/OBX (EC) 11283", "27949": "Elizabeth City/OBX (EC) 11283", "27950": "Elizabeth City/OBX (EC) 11283", "27954": "Elizabeth City/OBX (EC) 11283", "27956": "Elizabeth City/OBX (EC) 11283", "27953": "Elizabeth City/OBX (EC) 11283", "27958": "Elizabeth City/OBX (EC) 11283", "27959": "Elizabeth City/OBX (EC) 11283", "27960": "Elizabeth City/OBX (EC) 11283", "27964": "Elizabeth City/OBX (EC) 11283", "27965": "Elizabeth City/OBX (EC) 11283", "27966": "Elizabeth City/OBX (EC) 11283", "27968": "Elizabeth City/OBX (EC) 11283", "27972": "Elizabeth City/OBX (EC) 11283", "27973": "Elizabeth City/OBX (EC) 11283", "27974": "Elizabeth City/OBX (EC) 11283", "27976": "Elizabeth City/OBX (EC) 11283", "27978": "Elizabeth City/OBX (EC) 11283", "27979": "Elizabeth City/OBX (EC) 11283", "27982": "Elizabeth City/OBX (EC) 11283", "27980": "Elizabeth City/OBX (EC) 11283", "27981": "Elizabeth City/OBX (EC) 11283", "23601": "Newport News (NN) 12119", "23602": "Newport News (NN) 12119", "23603": "Newport News (NN) 12119", "23604": "Newport News (NN) 12119", "23605": "Newport News (NN) 12119", "23606": "Newport News (NN) 12119", "23607": "Newport News (NN) 12119", "23608": "Newport News (NN) 12119", "23609": "Newport News (NN) 12119", "23612": "Newport News (NN) 12119", "23628": "Newport News (NN) 12119", "23462": "Kempsville (K) 12120", "23464": "Kempsville (K) 12120", "20141": "Loudoun S (LS) 12188", "20132": "Loudoun S (LS) 12188", "20180": "Loudoun N/Leesburg (LN) 12095", "20197": "Loudoun N/Leesburg (LN) 12095", "20129": "Loudoun N/Leesburg (LN) 12095", "20175": "Loudoun S (LS) 12188", "20158": "Loudoun N/Leesburg (LN) 12095", "20147": "Loudoun E (LE) 12187", "20176": "Loudoun N/Leesburg (LN) 12095", "20131": "Loudoun S (LS) 12188", "20134": "Loudoun N/Leesburg (LN) 12095", "20142": "Loudoun N/Leesburg (LN) 12095", "20159": "Loudoun N/Leesburg (LN) 12095", "20160": "Loudoun N/Leesburg (LN) 12095", "20177": "Loudoun N/Leesburg (LN) 12095", "20178": "Loudoun N/Leesburg (LN) 12095", "Arlington (PSP Franchise # 443253)": "Loudoun N/Leesburg (LN) 12095", "22213": "N Arlington (NA) 12096", "22205": "N Arlington (NA) 12096", "22207": "N Arlington (NA) 12096", "22203": "N Arlington (NA) 12096", "22209": "N Arlington (NA) 12096", "22210": "N Arlington (NA) 12096", "22201": "N Arlington (NA) 12096", "22216": "N Arlington (NA) 12096", "22217": "N Arlington (NA) 12096", "22219": "N Arlington (NA) 12096", "22226": "N Arlington (NA) 12096", "22230": "N Arlington (NA) 12096", "22066": "Vienna/ Great Falls (V) 12097", "22102": "Vienna/ Great Falls (V) 12097", "22182": "Vienna/ Great Falls (V) 12097", "22181": "Vienna/ Great Falls (V) 12097", "22180": "Vienna/ Great Falls (V) 12097", "22031": "Fairfax (F) 12186", "22124": "Fairfax (F) 12186", "22042": "Vienna/ Great Falls (V) 12097", "22027": "Vienna/ Great Falls (V) 12097", "22152": "Vienna/ Great Falls (V) 12097", "22116": "Vienna/ Great Falls (V) 12097", "22183": "Vienna/ Great Falls (V) 12097", "22039": "W Springfield/ Newington (WS)", "22015": "W Springfield/ Newington (WS)", "22079": "W Springfield/ Newington (WS)", "22150": "W Springfield/ Newington (WS)", "22153": "W Springfield/ Newington (WS)", "22151": "W Springfield/ Newington (WS)", "22030": "Fairfax (F) 12186", "22035": "Fairfax (F) 12186", "22033": "Fairfax (F) 12186", "22038": "Fairfax (F) 12186", "22032": "Fairfax (F) 12186", "22185": "Fairfax (F) 12186", "20101": "Loudoun E (LE) 12187", "20103": "Loudoun E (LE) 12187", "20104": "Loudoun E (LE) 12187", "20148": "Loudoun S (LS) 12188", "20149": "Loudoun E (LE) 12187", "20146": "Loudoun E (LE) 12187", "20163": "Loudoun E (LE) 12187", "20164": "Loudoun E (LE) 12187", "20165": "Loudoun E (LE) 12187", "20166": "Loudoun S (LS) 12188", "20167": "Loudoun E (LE) 12187", "20102": "Loudoun S (LS) 12188", "20117": "Loudoun S (LS) 12188", "20120": "Loudoun S (LS) 12188", "20105": "Loudoun S (LS) 12188", "20135": "Loudoun S (LS) 12188", "20152": "Loudoun S (LS) 12188", "20184": "Loudoun S (LS) 12188", "22093": "Loudoun S (LS) 12188"};

    const franchiseNameTranslation = {
        "Chesterfield (C) 5248": "Chesterfield",
        "Richmond (R) 10313": "Richmond",
        "Henrico (H) 10314": "Henrico County",
        "Tri-Cities (T) 8510": "Tri-Cities Plus",
        "Chesapeake N (CN) 11281": "Chesapeake North",
        "Hampton North (HN) 11282": "Hampton North",
        "Norfolk (N) 11593": "Norfolk West",
        "Portsmouth (P) 11594": "Portsmouth",
        "Elizabeth City/OBX (EC) 11283": "Elizabeth City/Outer Banks",
        "Newport News (NN) 12119": "Newport News",
        "Kempsville (K) 12120": "Kempsville/Military Circle",
        "Loudoun N/Leesburg (LN) 12095": "Loudoun County North, Leesburg",
        "N Arlington (NA) 12096": "North Arlington",
        "Vienna/ Great Falls (V) 12097": "Vienna, Great Falls",
        "W Springfield/ Newington (WS)": "West Springfield/Newington",
        "Fairfax (F) 12186": "Fairfax",
        "Loudoun E (LE) 12187": "Loudoun County East",
        "Loudoun S (LS) 12188": "Loudoun County South"
    };

    // ==========================================
    //  CREATEJOB.ASPX - SPECIFIC LOOKUP TABLES
    // ==========================================

    // Which of the 3 "SERVPRO of ___" Office options each franchise belongs to
    const officeGroupMap = {
        "Chesterfield (C) 5248": "Chesterfield",
        "Richmond (R) 10313": "Chesterfield",
        "Henrico (H) 10314": "Chesterfield",
        "Tri-Cities (T) 8510": "Chesterfield",

        "Chesapeake N (CN) 11281": "Chesapeake",
        "Hampton North (HN) 11282": "Chesapeake",
        "Norfolk (N) 11593": "Chesapeake",
        "Portsmouth (P) 11594": "Chesapeake",
        "Elizabeth City/OBX (EC) 11283": "Chesapeake",
        "Newport News (NN) 12119": "Chesapeake",
        "Kempsville (K) 12120": "Chesapeake",

        "Loudoun N/Leesburg (LN) 12095": "Arlington",
        "N Arlington (NA) 12096": "Arlington",
        "Vienna/ Great Falls (V) 12097": "Arlington",
        "W Springfield/ Newington (WS)": "Arlington",
        "Fairfax (F) 12186": "Arlington",
        "Loudoun E (LE) 12187": "Arlington",
        "Loudoun S (LS) 12188": "Arlington"
    };

    // Custom Code (Environmental Code) dropdown text, exactly as it appears on CreateJob.aspx
    const customCodeMap = {
        "Chesterfield (C) 5248": "Chesterfield",
        "Richmond (R) 10313": "Richmond",
        "Henrico (H) 10314": "Henrico",
        "Tri-Cities (T) 8510": "Tri-Cities",
        "Chesapeake N (CN) 11281": "Chesapeake North",
        "Hampton North (HN) 11282": "Hampton",
        "Norfolk (N) 11593": "Norfolk",
        "Portsmouth (P) 11594": "Portsmouth",
        "Elizabeth City/OBX (EC) 11283": "Elizabeth City/OBX",
        "Newport News (NN) 12119": "Newport News",
        "Kempsville (K) 12120": "Kempsville",
        "Loudoun N/Leesburg (LN) 12095": "Loudoun County North, Leesburg",
        "N Arlington (NA) 12096": "North Arlington",
        "Vienna/ Great Falls (V) 12097": "Vienna, Great Falls",
        "W Springfield/ Newington (WS)": "West Springfield, Newington",
        "Fairfax (F) 12186": "Fairfax",
        "Loudoun E (LE) 12187": "Loudoun County East",
        "Loudoun S (LS) 12188": "Loudoun County South"
    };

    // Loss Type -> Secondary Loss Type, keyed by the WC "Type of Loss" value (lowercase)
    const lossTypeMap = {
        "water":      { lossType: "Water",      secondary: "Water Damage Remediation" },
        "sewage":     { lossType: "Water",      secondary: "Water Damage Remediation" },
        "storm":      { lossType: "Water",      secondary: "Water Damage Remediation" },
        "fire":       { lossType: "Fire",       secondary: "Fire Remediation" },
        "mold":       { lossType: "Mold",       secondary: "Mold Remediation" },
        "bio hazard": { lossType: "Bio Hazard", secondary: "Bio Hazard Remediation" },
        "biohazard":  { lossType: "Bio Hazard", secondary: "Bio Hazard Remediation" },
        "reconstruction": { lossType: "Reconstruction", secondary: "Reconstruction" }
    };
    const DEFAULT_LOSS_TYPE = { lossType: "Other", secondary: "Other" };

    // Source of Loss options on CreateJob.aspx (for word-matching against Cause of Loss)
    const sourceOfLossOptions = ["Air Conditioner","Air Conditioning Condenser Line","Air Conditioning Drain Pan","Aircraft","Angle Stop","Arson","Bath tub","Bidet","Blocked Rain Gutter","Boat","Candle","Car","Chimney","Cigarette","Clogged Drain","Clogged Toilet","Cold Water Supply Line","Dishwasher","Dishwasher Drain Line","Dishwasher Supply Line","Door Leak","Drain Backup","Drain Line","Dryer","Dryer Vent","Electrical","Falling Object","Fire Hydrant","Fire Sprinkler","Fireplace","Fish Tank","Flood","Frozen Pipe Burst","Furnace","Garbage Disposal","Ground Surface Water","Hose Bib","Hot Water Supply Line","Hurricane","HVAC","HVAC Drain Line","HVAC Freeze","HVAC Pan Overflow","HVAC Pump","HVAC/AC Unit","Ice Maker Supply Line","Instant Water Heater","Landscape Irrigation","Landslide","Lightning","MethLab","Microwave","Mine Subsidence","Mudslide","Oil Rags","Other","Patio Drain","Pipe Break","Pipe Leak","Plumbing","Pool System","Pressure Regulator","Refrigerator","Refrigerator Supply Line","Reverse Osmosis System","Roof","Roof Drain","Roof Leak","Septic System","Sewer","Shower","Shower Cartridge","Shower Drain Line","Shower Head","Shower Pan","Shower Supply Line","Shower/Tub Overflow","Sink","Sink Drain Line","Sink hole","Sink Overflow","Sink Supply Line","Slab LeaK","Small Appliance","Snow","Soft Clog Overflow","Space Heater","Sprinkler System","Steam System","Stove Oven","Strong Winds","Sump Pump Failure","Supply Line","Toilet","Toilet Drain Line","Toilet Overflow","Toilet Supply Line","Toilet Tank","Tornado","Tree","Tree Fall","Truck","Unknown","Vandalism","Vehicle","Vehicle Impact","Washing Machine","Washing Machine Drain Line","Washing Machine Supply Line","Water Filter","Water Heater","Water Heater Supply Line","Water Intrusion","Water Logged","Water Main","Wildfire","Wind-Driven Rain","Window Leak"];

    // CreateJob.aspx Telerik control client IDs
    const CJ = {
        JobName:           "ctl00_ContentPlaceHolder1_JobParentInformation_GenaralInfo_JobNameRadTextBox",
        ReportedBy:        "ctl00_ContentPlaceHolder1_JobParentInformation_GenaralInfo_DropDown_ReportedBY",
        ReferredBy:        "ctl00_ContentPlaceHolder1_JobParentInformation_GenaralInfo_DropDown_ReferredBy",
        LossCategory:      "ctl00_ContentPlaceHolder1_JobParentInformation_GenaralInfo_comboBox_LossCategory",
        LossType:          "ctl00_ContentPlaceHolder1_JobParentInformation_GenaralInfo_comboBox_LossType",
        SecondaryLossType: "ctl00_ContentPlaceHolder1_JobParentInformation_GenaralInfo_comboBox_SecondryLossType",
        SourceOfLoss:      "ctl00_ContentPlaceHolder1_JobParentInformation_GenaralInfo_SourceOfLossComboBox",
        Office:            "ctl00_ContentPlaceHolder1_JobParentInformation_GenaralInfo_comboBoxOffice",
        CustomCode:        "ctl00_ContentPlaceHolder1_JobParentInformation_GenaralInfo_comboBoxEnvironmentalCode",
        DateOfLoss:        "ctl00_ContentPlaceHolder1_JobParentInformation_GenaralInfo_DatePicker_DateOffLoss",
        Estimator:         "ctl00_ContentPlaceHolder1_JobParentInformation_InternalParticpantsControl_InternalParticipantsList_ctl00_EstimatorComboBox",
        InsuranceCarrier:  "ctl00_ContentPlaceHolder1_JobParentInformation_ExternalParticipants_SystemCompanyParticipantCombobox_3",
        SelfPayCheckBox:   "ctl00_ContentPlaceHolder1_JobParentInformation_SelfPayJobCheckBox",
        ClaimNumber:       "ctl00_ContentPlaceHolder1_JobParentInformation_TextBox_ClaimNumber",
        PolicyNumber:      "ctl00_ContentPlaceHolder1_JobParentInformation_TextBox_PolicyNumber",
        LossDescription:   "ctl00_ContentPlaceHolder1_JobParentInformation_TextBox_LossDescription",
        // Customer Information (= billing)
    CustFirstName:   "ctl00_ContentPlaceHolder1_JobParentInformation_TextBox_FirstName",
    CustLastName:    "ctl00_ContentPlaceHolder1_JobParentInformation_TextBox_LastName",
    CustEmail:       "ctl00_ContentPlaceHolder1_JobParentInformation_TextBox_Email",
    CustAddress:     "ctl00_ContentPlaceHolder1_JobParentInformation_TextBox_Address_Input",
    CustZip:         "ctl00_ContentPlaceHolder1_JobParentInformation_TextBox_Zip",
    CustCity:        "ctl00_ContentPlaceHolder1_JobParentInformation_TextBox_City",
    CustState:       "ctl00_ContentPlaceHolder1_JobParentInformation_DropDown_State",
    CustMainPhone:   "ctl00_ContentPlaceHolder1_JobParentInformation_TextBox_MainPhone",
    SameAsCustomer:  "ctl00_ContentPlaceHolder1_JobParentInformation_CheckBox_SameIndividualAddress",
    // Job Address (= loss)
    LossFirstName:   "ctl00_ContentPlaceHolder1_JobParentInformation_TextBox_FirstNameLoss",
    LossLastName:    "ctl00_ContentPlaceHolder1_JobParentInformation_TextBox_LastNameLoss",
    LossAddress:     "ctl00_ContentPlaceHolder1_JobParentInformation_TextBox_AddressLoss_Input",
    LossZip:         "ctl00_ContentPlaceHolder1_JobParentInformation_TextBox_ZipLoss",
    LossCity:        "ctl00_ContentPlaceHolder1_JobParentInformation_TextBox_CityLoss",
    LossState:       "ctl00_ContentPlaceHolder1_JobParentInformation_DropDown_StateLoss",
    LossMainPhone:   "ctl00_ContentPlaceHolder1_JobParentInformation_TextBox_MainPhoneLoss",
    // Commercial: Customer As Company Information (= billing)
    CompanyCustomerSearch: "ctl00_ContentPlaceHolder1_JobParentInformation_DropDown_CompanyCustomer",
    CompanyName:      "ctl00_ContentPlaceHolder1_JobParentInformation_TextBox_CompanyName",
    CompanyEmail:     "ctl00_ContentPlaceHolder1_JobParentInformation_TextBox_CompanyEmail",
    CompanyAddress:   "ctl00_ContentPlaceHolder1_JobParentInformation_TextBox_CompanyAddress_Input",
    CompanyZip:       "ctl00_ContentPlaceHolder1_JobParentInformation_TextBox_CompanyZip",
    CompanyCity:      "ctl00_ContentPlaceHolder1_JobParentInformation_TextBox_CompanyCity",
    CompanyState:     "ctl00_ContentPlaceHolder1_JobParentInformation_DropDown_CompanyState",
    CompanyMainPhone: "ctl00_ContentPlaceHolder1_JobParentInformation_TextBox_CompanyMainPhone",
    // Commercial: Company Job Address Information (= loss); POC name goes here
    CompanyJobSameAddr:   "ctl00_ContentPlaceHolder1_JobParentInformation_checkBox_SameCompanyAddress",
    CompanyLossFirstName: "ctl00_ContentPlaceHolder1_JobParentInformation_RadTextBox_NewContactForOfficeFirstName",
    CompanyLossLastName:  "ctl00_ContentPlaceHolder1_JobParentInformation_RadTextBox_NewContactForOfficeLastName",
    CompanyAddressLoss:   "ctl00_ContentPlaceHolder1_JobParentInformation_TextBox_CompanyAddressLoss_Input",
    CompanyZipLoss:       "ctl00_ContentPlaceHolder1_JobParentInformation_TextBox_CompanyCityLoss",
    CompanyCityLoss:      "ctl00_ContentPlaceHolder1_JobParentInformation_TextBox_CompanyCityLoss",
    CompanyStateLoss:     "ctl00_ContentPlaceHolder1_JobParentInformation_DropDown_CompanyStateLoss",
    CompanyMainPhoneLoss: "ctl00_ContentPlaceHolder1_JobParentInformation_TextBox_CompanyMainPhoneLoss",
    CCFirstName:  "ctl00_ContentPlaceHolder1_JobParentInformation_TextBox_CCFirstName",
    CCLastName:   "ctl00_ContentPlaceHolder1_JobParentInformation_TextBox_CCLastName",
    CCMainPhone:  "ctl00_ContentPlaceHolder1_JobParentInformation_TextBox_CCMainPhone",
    ContactEmail: "ctl00_ContentPlaceHolder1_JobParentInformation_TextBox_ContactEmail",
    };

    // Division checkboxes (label -> checkbox element id)
    const DIVISION_CHECKBOXES = {
        "Mold":              "ctl00_ContentPlaceHolder1_JobParentInformation_CheckBox_RequiredServices_0",
        "Duct Cleaning":     "ctl00_ContentPlaceHolder1_JobParentInformation_CheckBox_RequiredServices_1",
        "Other":             "ctl00_ContentPlaceHolder1_JobParentInformation_CheckBox_RequiredServices_2",
        "Contents":          "ctl00_ContentPlaceHolder1_JobParentInformation_CheckBox_RequiredServices_3",
        "Reconstruction":    "ctl00_ContentPlaceHolder1_JobParentInformation_CheckBox_RequiredServices_4",
        "Pending":           "ctl00_ContentPlaceHolder1_JobParentInformation_CheckBox_RequiredServices_5",
        "Biohazard":         "ctl00_ContentPlaceHolder1_JobParentInformation_CheckBox_RequiredServices_6",
        "Fire":              "ctl00_ContentPlaceHolder1_JobParentInformation_CheckBox_RequiredServices_7",
        "Water":             "ctl00_ContentPlaceHolder1_JobParentInformation_CheckBox_RequiredServices_8",
        "Temporary Repairs": "ctl00_ContentPlaceHolder1_JobParentInformation_CheckBox_RequiredServices_9"
    };

    // Type of Loss (from data key) -> Division checkbox label
    const divisionMap = {
        "water":          "Water",
        "sewage":         "Water",
        "storm":          "Water",
        "fire":           "Fire",
        "mold":           "Mold",
        "bio hazard":     "Biohazard",
        "biohazard":      "Biohazard",
        "reconstruction": "Reconstruction",
        "duct cleaning":  "Duct Cleaning",
        "contents":       "Contents",
        "temporary repairs": "Temporary Repairs"
    };
    const DEFAULT_DIVISION = "Other";

// --- Floating UI Setup ---
    const isDash = location.hostname.includes('ngsapps.net');
    const themeColor = isDash ? '#007CB9' : '#ff8200';

    const panel = document.createElement('div');
    panel.style.position = 'fixed';
    panel.style.top = '270px';
    panel.style.right = '20px';
    panel.style.zIndex = '9999';
    panel.style.backgroundColor = '#fff';
    panel.style.border = `2px solid ${themeColor}`;
    panel.style.padding = '0';
    panel.style.boxShadow = '0 4px 8px rgba(0,0,0,0.1)';
    panel.style.borderRadius = '4px';
    panel.style.overflow = 'hidden';
    panel.style.width = '272px';

    // Header bar (drag handle + close button)
    const header = document.createElement('div');
    header.style.display = 'flex';
    header.style.alignItems = 'center';
    header.style.justifyContent = 'space-between';
    header.style.backgroundColor = themeColor;
    header.style.color = '#fff';
    header.style.padding = '6px 10px';
    header.style.cursor = 'move';
    header.style.userSelect = 'none';
    header.style.fontFamily = 'Arial, sans-serif';
    header.style.fontSize = '13px';
    header.style.fontWeight = 'bold';

    const title = document.createElement('span');
    title.innerText = 'Intake Autofill';

    const closeBtn = document.createElement('span');
    closeBtn.innerHTML = '&times;';
    closeBtn.title = 'Close (until page refresh)';
    closeBtn.style.cursor = 'pointer';
    closeBtn.style.fontSize = '18px';
    closeBtn.style.lineHeight = '14px';
    closeBtn.style.padding = '0 2px';
    closeBtn.addEventListener('click', () => panel.remove());

    header.appendChild(title);
    header.appendChild(closeBtn);

    // Body (input + button)
    const body = document.createElement('div');
    body.style.padding = '10px';

    const inputBox = document.createElement('textarea');
    inputBox.placeholder = 'Paste data key here...';
    inputBox.style.width = '250px';
    inputBox.style.height = '60px';
    inputBox.style.marginBottom = '5px';
    inputBox.style.display = 'block';
    inputBox.style.boxSizing = 'border-box';

    const btn = document.createElement('button');
    btn.innerText = 'Autofill Form';
    btn.style.width = '100%';
    btn.style.backgroundColor = themeColor;
    btn.style.color = '#fff';
    btn.style.border = 'none';
    btn.style.padding = '8px';
    btn.style.cursor = 'pointer';
    btn.style.borderRadius = '3px';

    body.appendChild(inputBox);
    body.appendChild(btn);

    panel.appendChild(header);
    panel.appendChild(body);
    document.body.appendChild(panel);

    // --- Drag-to-move logic ---
    (function makeDraggable() {
        let dragging = false, offsetX = 0, offsetY = 0;

        header.addEventListener('mousedown', (e) => {
            // Don't start a drag when clicking the close button
            if (e.target === closeBtn) return;
            dragging = true;
            let rect = panel.getBoundingClientRect();
            offsetX = e.clientX - rect.left;
            offsetY = e.clientY - rect.top;
            // Switch from right-anchored to left-anchored so dragging works smoothly
            panel.style.left = rect.left + 'px';
            panel.style.top = rect.top + 'px';
            panel.style.right = 'auto';
            e.preventDefault();
        });

        document.addEventListener('mousemove', (e) => {
            if (!dragging) return;
            let newLeft = e.clientX - offsetX;
            let newTop = e.clientY - offsetY;
            // Keep it within the viewport
            newLeft = Math.max(0, Math.min(newLeft, window.innerWidth - panel.offsetWidth));
            newTop = Math.max(0, Math.min(newTop, window.innerHeight - panel.offsetHeight));
            panel.style.left = newLeft + 'px';
            panel.style.top = newTop + 'px';
        });

        document.addEventListener('mouseup', () => { dragging = false; });
    })();

    // ==========================================
    //  SHARED HELPER FUNCTIONS
    // ==========================================
    // Plain RadInput textbox setter (for First/Last/Email/Zip/City)
function setPlainTextBox(id, value) {
        if (!value) return;
        let el = document.getElementById(id);
        if (!el) return;
        // Prefer the Telerik client object so framework state (and the gray placeholder) clears properly
        let tb = window.$find && window.$find(id);
        if (tb && tb.set_value) {
            try { tb.set_value(value); } catch (e) {}
        }
        el.value = value;
        el.classList.remove('riEmpty', 'rcbEmptyMessage', 'rsbEmptyMessage');
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.dispatchEvent(new Event('blur', { bubbles: true }));
        let hidden = document.getElementById(id + "_ClientState");
        if (hidden) {
            try {
                let s = JSON.parse(hidden.value);
                s.valueAsString = value;
                s.lastSetTextBoxValue = value;
                hidden.value = JSON.stringify(s);
            } catch (e) {}
        }
        console.log(`✓ Set ${id} → ${value}`);
    }

    // Masked phone setter ( mask is _-___-___-____ → 1-XXX-XXX-XXXX )
    function setMaskedPhone(id, rawPhone) {
        if (!rawPhone) return;
        let digits = (rawPhone.match(/\d/g) || []).join("");
        if (digits.length === 10) digits = "1" + digits;       // prepend country code
        if (digits.length < 11) return;
        let formatted = `${digits[0]}-${digits.slice(1,4)}-${digits.slice(4,7)}-${digits.slice(7,11)}`;

        let el = document.getElementById(id);
        if (!el) return;

        // Commit through the Telerik MaskedTextBox client object so the mask state updates
        let mtb = window.$find && window.$find(id);
        if (mtb) {
            try {
                if (mtb.set_value) mtb.set_value(formatted);
                // RadMaskedTextBox stores the unmasked value separately; set both if available
                if (mtb._setValue) mtb._setValue(formatted);
                if (mtb.get_element) {
                    let inner = mtb.get_element();
                    if (inner) inner.value = formatted;
                }
                if (mtb.updateCssClass) mtb.updateCssClass();
            } catch (e) {}
        }

        el.value = formatted;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.dispatchEvent(new Event('blur', { bubbles: true }));

        let hidden = document.getElementById(id + "_ClientState");
        if (hidden) {
            try {
                let s = JSON.parse(hidden.value);
                s.valueAsString = formatted;
                s.valueWithPromptAndLiterals = formatted;
                s.lastSetTextBoxValue = formatted;
                hidden.value = JSON.stringify(s);
            } catch (e) {}
        }
        console.log(`✓ Set phone ${id} → ${formatted}`);
    }

    // RadSearchBox address setter (Address fields are RadSearchBox, not RadComboBox)
    function setSearchBoxAddress(id, value) {
        if (!value) return;
        let el = document.getElementById(id);
        if (!el) return;
        el.value = value;
        el.classList.remove('rsbEmptyMessage');
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        console.log(`✓ Set address ${id} → ${value}`);
    }

    function excelDateToJSDate(serial) {
        if (!serial || isNaN(serial)) return null;
        const utc_days  = Math.floor(serial - 25569);
        const utc_value = utc_days * 86400;
        const date_info = new Date(utc_value * 1000);
        return new Date(date_info.getFullYear(), date_info.getMonth(), date_info.getDate() + 1);
    }

    function parseTimeWindow(timeStr, dateBase) {
        if (!dateBase || !timeStr) return { begin: null, end: null };
        let parts = timeStr.toLowerCase().replace(/\s+/g, '').split('-');
        if (parts.length < 2) return { begin: dateBase, end: dateBase };
        let beginStr = parts[0], endStr = parts[1];
        let isPmEnd = endStr.includes('pm'), isAmEnd = endStr.includes('am');
        let isPmBegin = beginStr.includes('pm') || (isPmEnd && !beginStr.includes('am'));

        let beginHour = parseInt(beginStr.match(/\d+/)[0]);
        let endHour = parseInt(endStr.match(/\d+/)[0]);
        if (isPmBegin && beginHour !== 12) beginHour += 12;
        if (!isPmBegin && beginHour === 12) beginHour = 0;
        if (isPmEnd && endHour !== 12) endHour += 12;
        if (isAmEnd && endHour === 12) endHour = 0;
        if (isPmEnd && beginHour > endHour && beginHour < 12) beginHour -= 12;

        let beginDate = new Date(dateBase); beginDate.setHours(beginHour, 0, 0, 0);
        let endDate = new Date(dateBase); endDate.setHours(endHour, 0, 0, 0);
        return { begin: beginDate, end: endDate };
    }

    // Phase 19+ address parser (state+zip extracted together to avoid matching house numbers)
    function parseAddress(raw) {
        let result = { street: "", city: "", state: "", zip: "" };
        if (!raw) return result;

        // Extract state + zip together - the zip MUST immediately follow the state code.
        let stateZipMatch = raw.match(/\b([A-Z]{2})\s+(\d{5})(?:-\d{4})?\b/i);
        let cleanStr = raw;

        if (stateZipMatch) {
            result.state = stateZipMatch[1].toUpperCase();
            result.zip = stateZipMatch[2];
            cleanStr = cleanStr.slice(0, stateZipMatch.index) + cleanStr.slice(stateZipMatch.index + stateZipMatch[0].length);
        }

        cleanStr = cleanStr.replace(/,\s*$/, "").trim();

        if (cleanStr.includes(',')) {
            let parts = cleanStr.split(',').map(p => p.trim());
            result.street = parts[0];
            result.city = parts[1] || "";
        } else {
            let suffixes = ['street', 'avenue', 'road', 'boulevard', 'drive', 'lane', 'court', 'place', 'terrace', 'parkway', 'pike', 'highway', 'way'];
            let words = cleanStr.split(/\s+/);

            let splitIndex = -1;
            for (let i = words.length - 1; i >= 0; i--) {
                let word = words[i].toLowerCase().replace(/\.$/, '');
                if (suffixes.includes(word)) { splitIndex = i; break; }
            }

            if (splitIndex !== -1 && splitIndex < words.length - 1) {
                result.street = words.slice(0, splitIndex + 1).join(' ').trim();
                result.city = words.slice(splitIndex + 1).join(' ').trim();
            } else {
                result.city = words.pop().trim();
                result.street = words.join(' ').trim();
            }
        }

        return result;
    }

    // Comprehensive Fallback Resolver for Franchise
    function resolveFranchise(zip, city, envCode) {
        if (zip && zipToFranchiseMap[zip]) return zipToFranchiseMap[zip];

        let cLower = (city || "").toLowerCase();

        // Except VA Beach, that should be Kempsville
        if (cLower.includes("virginia beach") || cLower.includes("va beach")) return "Kempsville (K) 12120";

        // Tri-Cities will be any zip code that starts with 238—(except for Chester & Chesterfield)
        if (zip && zip.startsWith("238") && !cLower.includes("chester") && !cLower.includes("chesterfield")) return "Tri-Cities (T) 8510";

        // If it’s Chesterfield area and not on the zip list, put to Chesterfield
        if (cLower.includes("chesterfield") || cLower.includes("chester")) return "Chesterfield (C) 5248";

        // If it’s Chesapeake area and not on the zip list, put to Chesapeake South or North (Map to CN)
        if (cLower.includes("chesapeake")) return "Chesapeake N (CN) 11281";

        // If it’s Arlington area and not on the zip list, put to N Arlington.
        if (cLower.includes("arlington")) return "N Arlington (NA) 12096";

        // The other fall back for this is that the Environmental code should be provided when the FNOL is submitted, so fall back to that if it's not in the zip range.
        if (envCode) {
            let eLower = envCode.toLowerCase().trim();
            for (let key in customCodeMap) {
                if (customCodeMap[key].toLowerCase() === eLower) return key;
            }
            for (let key in franchiseNameTranslation) {
                if (franchiseNameTranslation[key].toLowerCase() === eLower) return key;
            }
        }

        return null;
    }

    function triggerKnockoutChange(elementId, value) {
        let el = typeof elementId === 'string' ? document.getElementById(elementId) : elementId;
        if (el && value !== undefined) {
            window.jQuery(el).val(value);
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
        }
    }

    function injectKO(selector, value, observableName) {
        let el = document.querySelector(selector);
        if (el && window.ko && value !== undefined && value !== "") {
            let koData = window.ko.dataFor(el);
            if (koData) {
                if (typeof koData[observableName] === 'function') {
                    koData[observableName](value);
                } else if (koData[observableName] !== undefined) {
                    koData[observableName] = value;
                }
            }
            window.jQuery(el).val(value);
            el.dispatchEvent(new Event('input', { bubbles: true }));
        }
    }

    // PREDICATE KENDO ENGINE - Zero Mathematical Offsets (WorkCenter)
    function setKendoDropdownExact(elementId, text) {
        if (!window.jQuery || !text) return;
        let el = window.jQuery(`#${elementId}`);
        let widget = el.data("kendoDropDownList") || el.data("kendoComboBox");

        if (widget) {
            let targetText = text.toLowerCase().trim();

            widget.select(function(dataItem) {
                let itemText = "";
                if (typeof dataItem === 'string') itemText = dataItem;
                else {
                    let tField = widget.options.dataTextField;
                    if (tField && dataItem[tField]) itemText = dataItem[tField].toString();
                    else itemText = (dataItem.Name || dataItem.name || dataItem.Text || dataItem.text || dataItem.Description || "").toString();
                }
                return itemText.toLowerCase().trim() === targetText;
            });

            let selectedData = widget.dataItem();
            let isPlaceholder = !selectedData || selectedData === "Please Select..." || (selectedData.Name && selectedData.Name.includes("Select"));

            if (widget.selectedIndex === -1 || isPlaceholder) {
                widget.select(function(dataItem) {
                    let itemText = "";
                    if (typeof dataItem === 'string') itemText = dataItem;
                    else {
                        let tField = widget.options.dataTextField;
                        if (tField && dataItem[tField]) itemText = dataItem[tField].toString();
                        else itemText = (dataItem.Name || dataItem.name || dataItem.Text || dataItem.text || dataItem.Description || "").toString();
                    }
                    let lowerItem = itemText.toLowerCase().trim();
                    if (!lowerItem || lowerItem.includes("please select")) return false;

                    if (lowerItem.includes(targetText) || targetText.includes(lowerItem)) return true;

                    let targetWords = targetText.split(/\s+/);
                    let itemWords = lowerItem.split(/\s+/);
                    if (targetWords.length > 1 && itemWords.length > 1) {
                        if (itemWords[0][0] === targetWords[0][0] && itemWords[itemWords.length - 1] === targetWords[targetWords.length - 1]) {
                            return true;
                        }
                    }
                    return false;
                });
            }

            widget.trigger("change");
            if (el[0]) el[0].dispatchEvent(new Event('change', { bubbles: true }));
        }
    }

    // --- Reported By mapping (shared) ---
    function mapReportedBy(reportedByRaw) {
        let reportedBy = "Other";
        let reportedByLower = (reportedByRaw || "").toLowerCase().trim();

        if (reportedByLower.includes("adjuster")) {
            reportedBy = "Adjuster";
        } else if (reportedByLower.includes("bank")) {
            reportedBy = "Bank";
        } else if (reportedByLower.includes("broker") || reportedByLower.includes("agent")) {
            reportedBy = "Broker/Agent";
        } else if (reportedByLower.includes("child")) {
            reportedBy = "Child";
        } else if (reportedByLower.includes("decision maker") || reportedByLower.includes("company decision")) {
            reportedBy = "Company Decision Maker";
        } else if (reportedByLower.includes("consultant")) {
            reportedBy = "Consultant";
        } else if (reportedByLower.includes("customer")) {
            reportedBy = "Customer";
        } else if (reportedByLower.includes("employee")) {
            reportedBy = "Employee";
        } else if (reportedByLower.includes("estate executor") || reportedByLower.includes("executor")) {
            reportedBy = "Estate Executor";
        } else if (reportedByLower.includes("facility manager")) {
            reportedBy = "Facility Manager";
        } else if (reportedByLower.includes("friend")) {
            reportedBy = "Friend";
        } else if (reportedByLower.includes("general contractor") || reportedByLower.includes("contractor")) {
            reportedBy = "General Contractor";
        } else if (reportedByLower.includes("government agency") || reportedByLower.includes("government")) {
            reportedBy = "Government Agency";
        } else if (reportedByLower.includes("holding company")) {
            reportedBy = "Holding Company";
        } else if (reportedByLower.includes("incident alert") || reportedByLower.includes("iac")) {
            reportedBy = "Incident Alert Center (IAC)";
        } else if (reportedByLower.includes("initial contact")) {
            reportedBy = "Initial Contact";
        } else if (reportedByLower.includes("marketing rep")) {
            reportedBy = "Marketing Rep";
        } else if (reportedByLower.includes("neighbor")) {
            reportedBy = "Neighbor";
        } else if (reportedByLower.includes("occupant") || reportedByLower.includes("tenant")) {
            reportedBy = "Occupant/Tenant";
        } else if (reportedByLower.includes("onsite")) {
            reportedBy = "Onsite Contact";
        } else if (reportedByLower.includes("other relative")) {
            reportedBy = "Other Relative";
        } else if (reportedByLower.includes("owner")) {
            reportedBy = "Owner";
        } else if (reportedByLower.includes("parent") && !reportedByLower.includes("parent company")) {
            reportedBy = "Parent";
        } else if (reportedByLower.includes("parent company")) {
            reportedBy = "Parent Company";
        } else if (reportedByLower.includes("partner")) {
            reportedBy = "Partner";
        } else if (reportedByLower.includes("power of attorney")) {
            reportedBy = "Power of Attorney Holder";
        } else if (reportedByLower.includes("property manager")) {
            reportedBy = "Property Manager";
        } else if (reportedByLower.includes("realtor")) {
            reportedBy = "Realtor";
        } else if (reportedByLower.includes("servpro franchise") && !reportedByLower.includes("hq")) {
            reportedBy = "SERVPRO® Franchise";
        } else if (reportedByLower.includes("servpro hq") || reportedByLower.includes("hq priority")) {
            reportedBy = "SERVPRO® HQ Priority Response Specialist";
        } else if (reportedByLower.includes("spouse")) {
            reportedBy = "Spouse";
        } else if (reportedByLower.includes("tpa")) {
            reportedBy = "TPA Handler";
        } else {
            reportedBy = "Other";
        }
        return reportedBy;
    }

    // Reported By for CreateJob - maps to the combo's EXACT option text
    function mapReportedByCreateJob(reportedByRaw, isCommercial) {
        let r = (reportedByRaw || "").toLowerCase().trim();

        if (r.includes("adjuster")) return "Adjuster-Insurance";
        if (r.includes("insurance agent") || (r.includes("agent") && r.includes("insurance"))) return " Agent-Insurance";
        if (r.includes("real estate") || r.includes("realtor")) return "Agent-Real Estate";
        if (r.includes("contractor connection")) return "Contractor Connection ";
        if (r.includes("contractor")) return "Contractor";
        if (r.includes("facility") || r.includes("building manager")) return "Facility or Building Manager";
        if (r.includes("homeowner") || r.includes("owner")) return "Homeowner";
        if (r.includes("hygienist")) return "Industrial Hygienist";
        if (r.includes("property manager")) return "Property Manager";
        if (r.includes("relative") || r.includes("friend") || r.includes("neighbor") || r.includes("spouse") || r.includes("parent") || r.includes("child")) return "Relative, Friend or Neighbor";
        if (r.includes("marketing") || r.includes("sales")) return "Sales Marketing Representative ";
        if (r.includes("servpro hq") || r.includes("hq")) return "SERVPRO HQ";
        if (r.includes("servpro franchise") || r.includes("franchise")) return "SERVPRO Franchise";
        if (r.includes("tenant") || r.includes("occupant")) return "Tenant";

        // No clean match: commercial -> Facility or Building Manager, residential -> Homeowner
        return isCommercial ? "Facility or Building Manager" : "Homeowner";
    }

    // Referred By for CreateJob - returns the combo's actual display text to search for
    function mapReferredByCreateJob(referredByRaw) {
        let refLower = (referredByRaw || "").toLowerCase().trim();
        if (!refLower) return null;
        if (refLower.includes("servpro.com") || refLower.includes("servpro,com")) return "servpro.com";
        if (refLower.includes("google")) return "google";
        if (refLower.includes("hq")) return "servpro hq";
        // Everything else -> no reliable contact match; leave blank / Other
        return null;
    }

    // --- Referred By mapping (shared) ---
    function mapReferredBy(referredByRaw) {
        let referredBy = "Advertising - Other";
        let refLower = (referredByRaw || "").toLowerCase().trim();

        if (!refLower) return referredBy;

        if (refLower.includes("marketing rep")) {
            referredBy = "Advertising - Other";
        } else if (refLower.includes("hq") || refLower.includes("servpro hq")) {
            referredBy = "SERVPRO® Franchise Referral";
        } else if (refLower.includes("servpro.com") || refLower.includes("servpro,com") || refLower.includes("google") || refLower.includes("chatgpt")) {
            referredBy = "Internet/Web Search";
        } else if (refLower.includes("insurance agent")) {
            referredBy = "Insurance Agent";
        } else if (refLower.includes("insurance adjuster")) {
            referredBy = "Insurance Adjuster";
        } else if (refLower.includes("existing")) {
            referredBy = "Existing Relationship";
        } else if (refLower.includes("online") || refLower.includes("internet")) {
            referredBy = "Internet/Web Search";
        } else {
            referredBy = "Advertising - Other";
        }
        return referredBy;
    }

    // ==========================================
    //  CREATEJOB.ASPX HELPER FUNCTIONS (Telerik RadComboBox)
    // ==========================================
    const userModifiedFields = new Set();

    function getParticipantLabel(comboBoxElement) {
        const parentTable = comboBoxElement.closest('table[style="width: 100%;"]');
        if (!parentTable) return null;
        const labelSpan = parentTable.querySelector('.DashLabelFontStyle');
        return labelSpan ? labelSpan.textContent.trim() : null;
    }

    // Trigger the page's own ZIP->Country/State/County lookup
    function triggerZipBind(zipFieldId) {
        let el = document.getElementById(zipFieldId);
        if (!el) return;
        // Fire the inline onblur handler the page attached (BindIndividual[Loss]CountryStateByZip)
        if (typeof el.onblur === 'function') {
            try { el.onblur(); } catch (e) {}
        }
        el.dispatchEvent(new Event('blur', { bubbles: true }));
    }

    function isCompensationPlanDropdown(comboBoxElement) {
        const id = comboBoxElement.id || '';
        return id.includes('CompensationPlanComboBox');
    }

    function getCurrentDropdownValue(comboBoxElement) {
        const inputEl = comboBoxElement.querySelector('input.rcbInput');
        const hiddenField = comboBoxElement.querySelector('input[type="hidden"][name*="_ClientState"]');
        if (!inputEl || !hiddenField) return null;
        try {
            const clientState = JSON.parse(hiddenField.value);
            return { value: clientState.value, text: clientState.text || inputEl.value };
        } catch (e) {
            return { value: '', text: inputEl.value };
        }
    }

    function isDropdownReady(comboBoxElement) {
        const inputEl = comboBoxElement.querySelector('input.rcbInput');
        const hiddenField = comboBoxElement.querySelector('input[type="hidden"][name*="_ClientState"]');
        if (!inputEl || !hiddenField) return false;
        if (inputEl.disabled || inputEl.readOnly) return false;
        return comboBoxElement.offsetParent !== null;
    }

    function setDropdownValue(comboBoxElement, value, text, forceUpdate = false, retryCount = 0) {
        const maxRetries = 3;
        const retryDelay = 300;
        const inputEl = comboBoxElement.querySelector('input.rcbInput');
        const hiddenField = comboBoxElement.querySelector('input[type="hidden"][name*="_ClientState"]');
        if (!inputEl || !hiddenField) {
            if (retryCount < maxRetries) {
                setTimeout(() => setDropdownValue(comboBoxElement, value, text, forceUpdate, retryCount + 1), retryDelay);
                return false;
            }
            return false;
        }
        if (!isDropdownReady(comboBoxElement) && retryCount < maxRetries) {
            setTimeout(() => setDropdownValue(comboBoxElement, value, text, forceUpdate, retryCount + 1), retryDelay);
            return false;
        }
        const fieldId = inputEl.id || inputEl.name;
        if (!forceUpdate && userModifiedFields.has(fieldId)) {
            return true;
        }
        inputEl.value = text;
        if (value === '' || text === 'Select') {
            hiddenField.value = JSON.stringify({ logEntries: [], value: '', text: '', enabled: true, checkedIndices: [], checkedItemsTextOverflows: false });
            inputEl.classList.add('rcbEmptyMessage');
        } else {
            hiddenField.value = JSON.stringify({ logEntries: [], value, text, enabled: true, checkedIndices: [], checkedItemsTextOverflows: false });
            inputEl.classList.remove('rcbEmptyMessage');
        }
        inputEl.dispatchEvent(new Event('change', { bubbles: true }));
        hiddenField.dispatchEvent(new Event('change', { bubbles: true }));
        console.log(`✓ Set ${fieldId} → ${text}`);
        return true;
    }

    function waitForDropdownsReady(context, callback, timeout = 5000) {
        const startTime = Date.now();
        function checkReady() {
            const dropdowns = context.querySelectorAll('div[id*="EstimatorComboBox"].RadComboBox, div[id*="Estimator"].RadComboBox');
            if (dropdowns.length === 0) {
                if (Date.now() - startTime < timeout) { setTimeout(checkReady, 200); return; }
                callback(); return;
            }
            let readyCount = 0;
            dropdowns.forEach(d => { if (!isCompensationPlanDropdown(d) && isDropdownReady(d)) readyCount++; });
            if (readyCount > 0 || Date.now() - startTime >= timeout) { callback(); }
            else { setTimeout(checkReady, 200); }
        }
        checkReady();
    }

    // Find a RadComboBox client-side item by visible text (exact, then fuzzy)
    function findRadComboItemByText(comboBoxElement, text) {
        if (!window.$find || !text) return null;
        let combo = window.$find(comboBoxElement.id);
        if (!combo || !combo.get_items) return null;

        let target = text.toLowerCase().trim();
        let items = combo.get_items();
        let count = items.get_count();

        // exact match
        for (let i = 0; i < count; i++) {
            let item = items.getItem(i);
            let itemText = (item.get_text() || "").toLowerCase().trim();
            if (itemText === target) return item;
        }
        // fuzzy match (substring either direction)
        for (let i = 0; i < count; i++) {
            let item = items.getItem(i);
            let itemText = (item.get_text() || "").toLowerCase().trim();
            if (!itemText || itemText.includes("select")) continue;
            if (itemText.includes(target) || target.includes(itemText)) return item;
        }
        return null;
    }

    // Resolve text -> {value, text} via the Telerik client object, then write via setDropdownValue
    function setRadComboByText(comboBoxElement, text, forceUpdate = true) {
        if (!comboBoxElement || !text) return false;
        let item = findRadComboItemByText(comboBoxElement, text);
        if (item) {
            try { item.select(); } catch(e) {} // Forces validation state to acknowledge index change
            return setDropdownValue(comboBoxElement, item.get_value(), item.get_text(), forceUpdate);
        }
        console.log(`✗ No match found for "${text}" in #${comboBoxElement.id}`);
        return false;
    }

    function setRadComboByTextWithRetry(elementId, text, attempts = 10, delay = 300) {
        return new Promise((resolve) => {
            if (!text) return resolve(false);
            let tries = 0;
            let tryFn = () => {
                let el = document.getElementById(elementId);
                if (el && isDropdownReady(el)) {
                    let ok = setRadComboByText(el, text, true);
                    if (ok) return resolve(true);
                }
                tries++;
                if (tries < attempts) setTimeout(tryFn, delay);
                else { console.log(`✗ Gave up on #${elementId} -> "${text}"`); resolve(false); }
            };
            tryFn();
        });
    }

    // LOAD-ON-DEMAND combos (ReportedBy, ReferredBy, CustomCode, LossType, SecondaryLossType, Estimator, InsuranceCarrier):
    // their item list is EMPTY until the server is asked for items. Strategy:
    // 1. If items are already loaded, match directly.
    // 2. Otherwise call combo.requestItems(filterText) and match inside the itemsRequested event.
    // 3. If filtered request finds nothing, retry once with an empty filter (loads full list).
    function setLoadOnDemandCombo(clientId, text, useFilter = true) {
        return new Promise((resolve) => {
            if (!text) return resolve(false);
            let combo = window.$find ? window.$find(clientId) : null;
            let el = document.getElementById(clientId);
            if (!combo || !el) {
                console.log(`✗ Combo not found: #${clientId}`);
                return resolve(false);
            }

            let target = text.toLowerCase().trim();

            function matchLoadedItem() {
                let items = combo.get_items();
                let count = items.get_count();
                // exact first
                for (let i = 0; i < count; i++) {
                    let item = items.getItem(i);
                    let t = (item.get_text() || "").toLowerCase().trim();
                    if (t === target) return item;
                }
                // fuzzy
                for (let i = 0; i < count; i++) {
                    let item = items.getItem(i);
                    let t = (item.get_text() || "").toLowerCase().trim();
                    if (!t || t.includes("select")) continue;
                    if (t.includes(target) || target.includes(t)) return item;
                }
                return null;
            }

            function commit(item) {
                try { item.select(); } catch (e) { /* fall through to manual write */ }
                setDropdownValue(el, item.get_value(), item.get_text(), true);
                console.log(`✓ [LOD] #${clientId} -> "${item.get_text()}"`);
                resolve(true);
            }

            // Already loaded? Match immediately.
            if (combo.get_items().get_count() > 0) {
                let item = matchLoadedItem();
                if (item) return commit(item);
            }

            let attemptedFullLoad = false;

            let handler = function(sender, args) {
                let item = matchLoadedItem();
                if (item) {
                    combo.remove_itemsRequested(handler);
                    return commit(item);
                }
                if (!attemptedFullLoad) {
                    // Filtered request found nothing - load the full unfiltered list once
                    attemptedFullLoad = true;
                    setTimeout(() => { try { combo.requestItems("", false); } catch (e) {} }, 100);
                } else {
                    combo.remove_itemsRequested(handler);
                    console.log(`✗ [LOD] No match for "${text}" in #${clientId} after full load`);
                    resolve(false);
                }
            };
            combo.add_itemsRequested(handler);

            try {
                combo.requestItems(useFilter ? text : "", false);
            } catch (e) {
                combo.remove_itemsRequested(handler);
                console.log(`✗ [LOD] requestItems failed on #${clientId}:`, e.message);
                resolve(false);
            }

            // Safety: don't hang forever if the server never responds
            setTimeout(() => { combo.remove_itemsRequested(handler); resolve(false); }, 8000);
        });
    }

    function setRadTextBoxValue(clientId, text) {
        if (!text) return;
        let tb = window.$find && window.$find(clientId);
        if (tb && tb.set_value) {
            tb.set_value(text);
        }
        let inputEl = document.getElementById(clientId);
        if (inputEl) {
            inputEl.value = text;
            inputEl.dispatchEvent(new Event('input', { bubbles: true }));
            inputEl.dispatchEvent(new Event('change', { bubbles: true }));
        }
    }

    function setRadDate(clientId, jsDate) {
        if (!jsDate) return;
        let picker = window.$find && window.$find(clientId);
        if (picker && picker.set_selectedDate) {
            picker.set_selectedDate(jsDate);
        }
    }

    // Word-match Cause of Loss against the Source of Loss option list
    function matchSourceOfLoss(causeOfLossRaw) {
        if (!causeOfLossRaw) return null;
        let causeWords = causeOfLossRaw.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
        let bestOption = null, bestScore = 0;

        for (let option of sourceOfLossOptions) {
            let optWords = option.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
            let score = 0;
            for (let cw of causeWords) {
                for (let ow of optWords) {
                    if (cw === ow) { score += 2; }
                    else if (cw.length >= 4 && ow.length >= 4 && (cw.includes(ow) || ow.includes(cw))) { score += 1; }
                }
            }
            if (score > bestScore) { bestScore = score; bestOption = option; }
        }
        return bestScore > 0 ? bestOption : null;
    }

    // ==========================================
    //  WORKCENTER (intake) AUTOFILL
    // ==========================================
    function autofillWorkCenter(data) {
        const callerName = data[COLUMN.CallerName] || "";
        const propertyType = data[COLUMN.PropertyType] || "";
        const bizName = data[COLUMN.BusinessName] || "";
        let lossAddressRaw = data[COLUMN.LossAddress] || "";
        let billingAddressRaw = data[COLUMN.BillingAddress] || "";
        const phone = data[COLUMN.Phone] || "";
        const email = data[COLUMN.Email_Field] || "";
        const typeOfLoss = data[COLUMN.TypeOfLoss] || "";
        const dateOfLossRaw = data[COLUMN.DateOfLoss] || "";
        const reportedByRaw = data[COLUMN.ReportedBy] || "";
        const referredByRaw = data[COLUMN.ReferredBy] || "";
        const selfPayOrIns = data[COLUMN.SelfPayOrIns] || "";
        const claimNum = data[COLUMN.ClaimNum] || "";
        const insuranceCarrier = data[COLUMN.InsuranceCarrier] || "";
        let scheduledPMRaw = data[COLUMN.ScheduledPM] || "";
        const scheduledPM = scheduledPMRaw.trim() === "" ? "**NOT ASSIGNED**" : scheduledPMRaw;
        const arrivalDateRaw = data[COLUMN.ArrivalDate] || "";
        const arrivalTimeRaw = data[COLUMN.ArrivalTime] || "";

        if (lossAddressRaw.toLowerCase().includes("same as customer") || lossAddressRaw.toLowerCase().includes("same as billing")) {
            lossAddressRaw = billingAddressRaw;
        }

        let reportedBy = mapReportedBy(reportedByRaw);
        // Commercial: if no clean match, default to Facility Manager rather than Other
        if (propertyType.toLowerCase().includes('com') && reportedBy === "Other") {
            reportedBy = "Facility Manager";
        }
        const referredBy = mapReferredBy(referredByRaw);

        console.log("=== WC DEBUG INFO ===");
        console.log("callerName:", callerName, "selfPayOrIns:", selfPayOrIns, "scheduledPM:", scheduledPM);
        console.log("referredByRaw:", referredByRaw, "-> referredBy:", referredBy);
        console.log("reportedByRaw:", reportedByRaw, "-> reportedBy:", reportedBy);

        // --- Execution Step 1: Push Primary Forms Fields ---
        if (propertyType.toLowerCase().includes('res')) document.getElementById('radio1')?.click();
        if (propertyType.toLowerCase().includes('com')) document.getElementById('radio2')?.click();
        if (selfPayOrIns.toLowerCase().includes('self')) document.getElementById('selfpay')?.click();

        if (referredByRaw.toLowerCase().includes("servpro.com") || referredByRaw.toLowerCase().includes("servpro,com")) {
            document.getElementById('rdCallSourceServproCall')?.click();
        } else {
            document.getElementById('rdCallSourceOther')?.click();
        }

        // --- Execution Step 2: Main Form Populating ---
        setTimeout(() => {
            let prefix = propertyType ? propertyType.substring(0,3).toUpperCase() : "";
            let customNote = prefix && typeOfLoss ? `${prefix}/${typeOfLoss}` : (prefix || typeOfLoss || "");
            injectKO('#journalNote', customNote, 'value');

            let parsedAddress = parseAddress(lossAddressRaw);
            if (parsedAddress.street && parsedAddress.city) {
                injectKO('#customerAddress1', parsedAddress.street, 'value');
                injectKO('#callerCity', parsedAddress.city, 'value');
                injectKO('#callerPostalCode', parsedAddress.zip, 'value');
                setKendoDropdownExact('callerState', parsedAddress.state);

                let franchiseKey = resolveFranchise(parsedAddress.zip, parsedAddress.city, data[COLUMN.EnvironmentalCode]);
                if (franchiseKey) {
                    let translatedFranchiseName = franchiseNameTranslation[franchiseKey] || franchiseKey;
                    setKendoDropdownExact('FranchiseDD', translatedFranchiseName);
                }
            }

            setKendoDropdownExact('ddlLostType2', typeOfLoss);
            setKendoDropdownExact('ddReportedBy', reportedBy);
            setKendoDropdownExact('ddReferredBy', referredBy);

            if (insuranceCarrier && !selfPayOrIns.toLowerCase().includes('self')) {
                 setKendoDropdownExact('ddlInsuranceCarrier', insuranceCarrier);
            }

            if (window.jQuery) {
                let lossDateJS = excelDateToJSDate(parseFloat(dateOfLossRaw));
                let dolPicker = window.jQuery("input[data-bind*='DateOfLoss']").data("kendoDateTimePicker");
                if (dolPicker && lossDateJS) { dolPicker.value(lossDateJS); dolPicker.trigger("change"); }
            }
        }, 800);

        // --- Execution Step 3: Loss Characteristics & Site Appointment ---
        setTimeout(() => {
            let baseArrivalDate = excelDateToJSDate(parseFloat(arrivalDateRaw));
            if (baseArrivalDate) {
                let beginDate = new Date(baseArrivalDate); beginDate.setHours(0, 0, 0, 0);
                let endDate = new Date(baseArrivalDate); endDate.setHours(0, 0, 0, 0);

                let beginPicker = window.jQuery("input[data-bind*='SiteAppointmentBegin']").data("kendoDateTimePicker");
                if (beginPicker) { beginPicker.value(beginDate); beginPicker.trigger("change"); }

                let endPicker = window.jQuery("input[data-bind*='SiteAppointmentEnd']").data("kendoDateTimePicker");
                if (endPicker) { endPicker.value(endDate); endPicker.trigger("change"); }
            }

            setKendoDropdownExact('ddlLostType2', typeOfLoss);
            setKendoDropdownExact('byDD', scheduledPM);
            setKendoDropdownExact('ddCauseOfLoss', 'Other');
        }, 2200);

        // --- Execution Step 4: Insurance Details & Claim Number ---
        setTimeout(() => {
            if (!selfPayOrIns.toLowerCase().includes('self') && insuranceCarrier) {
                setKendoDropdownExact('ddlInsuranceCarrier', insuranceCarrier);
            }
            if (claimNum) {
                let claimInput = document.getElementById('txtClaimNumber');
                if (claimInput) {
                    claimInput.value = claimNum;
                    window.jQuery(claimInput).val(claimNum).trigger('input').trigger('change');
                }
            }
        }, 2800);

        // --- Execution Step 5: Priority Responder & Project Manager ---
        setTimeout(() => {
            let attempts = 0;
            let pmInterval = setInterval(() => {
                let pRes = window.jQuery('#priorityResponderDD').data("kendoDropDownList");
                let pMan = window.jQuery('#projectManagerDD').data("kendoDropDownList");

                if (pRes && pMan && pRes.dataSource.data().length > 0) {
                    setKendoDropdownExact('priorityResponderDD', scheduledPM);
                    setKendoDropdownExact('projectManagerDD', scheduledPM);
                    clearInterval(pmInterval);
                } else {
                    setKendoDropdownExact('priorityResponderDD', scheduledPM);
                    setKendoDropdownExact('projectManagerDD', scheduledPM);
                }

                attempts++;
                if (attempts > 10) clearInterval(pmInterval); // Stop after 5 seconds
            }, 500);
        }, 3200);

        // --- Execution Step 6: Force Open Add Caller Modal ---
        setTimeout(() => {
            let callerInput = document.getElementById("autoCompleteCallerContact");
            if (callerInput) {
                callerInput.value = callerName;
                callerInput.dispatchEvent(new Event("input", { bubbles: true }));
                callerInput.dispatchEvent(new Event("change", { bubbles: true }));
            }
            setTimeout(() => {
                let addBtn = window.jQuery("button[title*='Add'], button:has(i:contains('add')), button:has(i:contains('person_add'))").not(":disabled").first();
                if (addBtn.length) addBtn.click();
            }, 600);
        }, 2500);

        // ==========================================
        //  POPUP INTERACTION AUTOMATION WATCHERS
        // ==========================================

        // Watcher A: Undispositioned Calls Matching Engine
        let callDialogInterval = setInterval(() => {
            let dialog = window.jQuery("#callSourceDialog");
            if (dialog.length && dialog.is(":visible")) {
                clearInterval(callDialogInterval);
                let cleanTargetPhone = phone.replace(/\D/g, '');
                if (cleanTargetPhone.length > 10) cleanTargetPhone = cleanTargetPhone.slice(-10);
                let matched = false;

                let rows = dialog.find("table tbody tr");
                rows.each(function() {
                    let rowPhoneText = window.jQuery(this).text() || "";
                    let cleanRowPhone = rowPhoneText.replace(/\D/g, '');
                    if (cleanRowPhone && cleanTargetPhone && cleanRowPhone.includes(cleanTargetPhone)) {
                        let radioBtn = window.jQuery(this).find("input[type='radio'][name='selectedCall']");
                        radioBtn.click();
                        radioBtn.prop('checked', true);
                        matched = true;
                    }
                });

                if (matched) {
                    setTimeout(() => { dialog.find("button.btn-success").click(); }, 300);
                } else {
                    setTimeout(() => {
                        dialog.find("button.btn-danger").click();
                        setTimeout(() => {
                            let otherCallRadio = document.getElementById('rdCallSourceOther');
                            if (otherCallRadio) {
                                otherCallRadio.click();
                                otherCallRadio.checked = true;
                                window.jQuery(otherCallRadio).trigger('change');
                            }
                            setKendoDropdownExact('ddReferredBy', referredBy);
                        }, 500);
                    }, 300);
                }
            }
        }, 300);
        setTimeout(() => clearInterval(callDialogInterval), 15000);

        // Watcher B: Add/Edit Contact Modal Injector - Auto Fill & Save
        let contactDialogInterval = setInterval(() => {
            let dialogNode = document.getElementById("addEditContactDialog");
            if (dialogNode && window.jQuery(dialogNode).is(":visible")) {
                clearInterval(contactDialogInterval);

                let formattedPhone = phone;
                let cleanPhone = phone.replace(/\D/g, '');
                if (cleanPhone.length === 10) {
                    formattedPhone = `(${cleanPhone.substring(0,3)}) ${cleanPhone.substring(3,6)}-${cleanPhone.substring(6,10)}`;
                } else if (cleanPhone === "") {
                    formattedPhone = "";
                }

                let contactAddressRaw = billingAddressRaw;
                if (billingAddressRaw.toLowerCase().includes("same as loss") || billingAddressRaw === "") {
                    contactAddressRaw = lossAddressRaw;
                }

                setTimeout(() => {
                    let firstNameEl = document.getElementById('txtFirstName');
                    if (firstNameEl) {
                        let names = callerName.split(" ");
                        firstNameEl.value = names[0];
                        let koData = window.ko.dataFor(firstNameEl);
                        if (koData && typeof koData.FirstName === 'function') koData.FirstName(names[0]);
                        window.jQuery(firstNameEl).trigger('input').trigger('change');
                    }

                    let lastNameEl = document.getElementById('txtLastName');
                    if (lastNameEl) {
                        let names = callerName.split(" ");
                        lastNameEl.value = names.slice(1).join(" ");
                        let koData = window.ko.dataFor(lastNameEl);
                        if (koData && typeof koData.LastName === 'function') koData.LastName(names.slice(1).join(" "));
                        window.jQuery(lastNameEl).trigger('input').trigger('change');
                    }

                    let businessEl = document.getElementById('contact-business');
                    if (businessEl && bizName) {
                        businessEl.value = bizName;
                        window.jQuery(businessEl).trigger('input').trigger('change');
                    }

                    setKendoDropdownExact('titleDD', reportedBy);

                    let parsedAddress = parseAddress(contactAddressRaw);

                    let addr1 = document.getElementById('lossAddress1');
                    if (addr1 && parsedAddress.street) {
                        addr1.value = parsedAddress.street;
                        let koData = window.ko.dataFor(addr1);
                        if (koData && typeof koData.Address1 === 'function') koData.Address1(parsedAddress.street);
                        window.jQuery(addr1).val(parsedAddress.street).trigger('input').trigger('change');
                    }

                    let cityEl = document.getElementById('lossCity');
                    if (cityEl && parsedAddress.city) {
                        cityEl.value = parsedAddress.city;
                        let koData = window.ko.dataFor(cityEl);
                        if (koData && typeof koData.City === 'function') koData.City(parsedAddress.city);
                        window.jQuery(cityEl).trigger('input').trigger('change');
                    }

                    let zipEl = document.getElementById('contactAddEditPostalCode');
                    if (zipEl && parsedAddress.zip) {
                        zipEl.value = parsedAddress.zip;
                        let koData = window.ko.dataFor(zipEl);
                        if (koData && typeof koData.PostalCode === 'function') koData.PostalCode(parsedAddress.zip);
                        window.jQuery(zipEl).trigger('input').trigger('change');
                    }

                    if (parsedAddress.state) setKendoDropdownExact('contactStateDD', parsedAddress.state);

                    let addr2 = document.getElementById('lossAddress2');
                    if (addr2) {
                        addr2.value = '';
                        let koData = window.ko.dataFor(addr2);
                        if (koData && typeof koData.Address2 === 'function') koData.Address2('');
                        window.jQuery(addr2).trigger('input').trigger('change');
                    }
                }, 200);

                setTimeout(() => {
                    let phoneInputs = document.querySelectorAll("#divPhone input[type='text'][placeholder='Phone Number']");
                    if (phoneInputs.length > 1) {
                        for (let i = phoneInputs.length - 1; i >= 0; i--) {
                            let phoneValue = phoneInputs[i].value.trim();
                            if (phoneValue === '' || !phoneValue) {
                                let phoneRow = phoneInputs[i].closest('.row');
                                let deleteBtn = phoneRow.querySelector("span[data-bind*='deletePhone']");
                                if (deleteBtn && deleteBtn.offsetParent !== null) deleteBtn.click();
                            }
                        }
                    }
                }, 300);

                setTimeout(() => {
                    if (formattedPhone && formattedPhone.trim() !== "") {
                        let phoneInputs = document.querySelectorAll("#divPhone input[type='text'][placeholder='Phone Number']");
                        if (phoneInputs.length > 0) {
                            let phoneInput = phoneInputs[0];
                            phoneInput.value = formattedPhone;
                            let koData = window.ko.dataFor(phoneInput);
                            if (koData && typeof koData.Number === 'function') koData.Number(formattedPhone);
                            window.jQuery(phoneInput).val(formattedPhone).trigger('input').trigger('change');
                        }
                    }
                }, 350);

                setTimeout(() => {
                    if (email && email.trim() !== "" && email.includes("@")) {
                        let emailInputs = document.querySelectorAll("#divConnections input[type='text']");
                        if (emailInputs.length > 0) {
                            let emailInput = emailInputs[0];
                            emailInput.value = email;
                            let koData = window.ko.dataFor(emailInput);
                            if (koData && typeof koData.ConnectionText === 'function') koData.ConnectionText(email);
                            window.jQuery(emailInput).val(email).trigger('input').trigger('change');
                        }
                    }
                }, 400);

                setTimeout(() => {
                    let saveBtn = document.getElementById('btnSaveContact');
                    if (saveBtn && !saveBtn.disabled) saveBtn.click();
                }, 600);
            }
        }, 300);
        setTimeout(() => clearInterval(contactDialogInterval), 25000);

        // Watcher C: "Same as Caller" Auto-Kicker
        // Delay the start of this watcher by 5 seconds to ensure the Caller modal has been completely processed and closed.
        setTimeout(() => {
            let sameAsCallerInterval = setInterval(() => {
                let contactDialog = document.getElementById("addEditContactDialog");
                let callerInput = document.getElementById("autoCompleteCallerContact");

                // Only proceed if the dialog is NOT open AND the Caller input actually has text
                let isModalOpen = contactDialog && window.jQuery(contactDialog).is(":visible");
                let isCallerFilled = callerInput && callerInput.value.trim() !== "";

                if (!isModalOpen && isCallerFilled) {
                    let sameAsBtn = document.querySelector("button[data-bind*='sameAsCallerClick']");
                    if (sameAsBtn && sameAsBtn.offsetParent !== null) { // Element is visible on screen
                        let koContext = window.ko && window.ko.contextFor ? window.ko.contextFor(sameAsBtn) : null;
                        if (koContext && koContext.$parent && typeof koContext.$parent.sameAsCallerClick === 'function') {
                            koContext.$parent.sameAsCallerClick();
                        } else {
                            sameAsBtn.click();
                        }
                        console.log("✓ Clicked 'Same as Caller'");
                        clearInterval(sameAsCallerInterval);
                    }
                }
            }, 500);

            // Give up after 20 seconds
            setTimeout(() => clearInterval(sameAsCallerInterval), 20000);
        }, 5000); // 5-second initial delay guarantees it waits for Step 6 and Watcher B to finish
    }

    // ==========================================
    //  CREATEJOB.ASPX AUTOFILL
    // ==========================================
    async function autofillCreateJob(data) {
        const callerName = data[COLUMN.CallerName] || "";
        const phone = data[COLUMN.Phone] || "";
        const email = data[COLUMN.Email_Field] || "";
        const propertyType = data[COLUMN.PropertyType] || "";
        let lossAddressRaw = data[COLUMN.LossAddress] || "";
        let billingAddressRaw = data[COLUMN.BillingAddress] || "";
        const typeOfLoss = data[COLUMN.TypeOfLoss] || "";
        const dateOfLossRaw = data[COLUMN.DateOfLoss] || "";
        const causeOfLoss = data[COLUMN.CauseOfLoss] || "";
        const reportedByRaw = data[COLUMN.ReportedBy] || "";
        const referredByRaw = data[COLUMN.ReferredBy] || "";
        const selfPayOrIns = data[COLUMN.SelfPayOrIns] || "";
        const insuranceCarrier = data[COLUMN.InsuranceCarrier] || "";
        const claimNum = data[COLUMN.ClaimNum] || "";
        const policyNum = data[COLUMN.PolicyNum] || "";
        let scheduledPMRaw = data[COLUMN.ScheduledPM] || "";
        const scheduledPM = scheduledPMRaw.trim() === "" ? "**NOT ASSIGNED**" : scheduledPMRaw;

        if (lossAddressRaw.toLowerCase().includes("same as customer") || lossAddressRaw.toLowerCase().includes("same as billing")) {
            lossAddressRaw = billingAddressRaw;
        }

let reportedBy = mapReportedBy(reportedByRaw);
        // Commercial: if no clean match, default to Facility Manager rather than Other
        if (propertyType.toLowerCase().includes('com') && reportedBy === "Other") {
            reportedBy = "Facility Manager";
        }
        const referredBy = mapReferredBy(referredByRaw);
        const isSelfPay = selfPayOrIns.toLowerCase().includes('self');

        // ---- Customer Information (billing) + Job Address (loss) ----
        // Split POC name into First / Last
        let nameParts = (callerName || "").trim().split(/\s+/);
        let custFirst = nameParts.length >= 2 ? nameParts.slice(0, -1).join(" ") : (nameParts[0] || "");
        let custLast  = nameParts.length >= 2 ? nameParts[nameParts.length - 1] : "";

        let lossParsed = parseAddress(lossAddressRaw);
        let billingSame = (billingAddressRaw || "").toLowerCase().includes("same");

        // Customer (= billing). If billing is "same as loss", Customer gets the loss address.
        let custAddr = billingSame ? lossParsed : parseAddress(billingAddressRaw);

        let isCommercial = propertyType.toLowerCase().includes('com');
        let bizName = data[COLUMN.BusinessName] || "";

        if (isCommercial) {
            // Ensure Company Customer mode is active
            let companyRadio = document.getElementById("ctl00_ContentPlaceHolder1_JobParentInformation_RadioButton_CompanyCustomer");
            if (companyRadio && !companyRadio.checked) {
                companyRadio.click();
                await new Promise(r => setTimeout(r, 800));
            }

            // Best-effort: link an existing company customer by billing address
            try {
                let custMatch = await findCompanyCustomerByAddress(custAddr);
                if (custMatch) {
                    let boxEl = document.getElementById(CJ.CompanyCustomerSearch);
                    if (boxEl) {
                        setDropdownValue(boxEl, custMatch.Value, custMatch.Text, true);
                        console.log(`✓ Existing company customer matched -> "${custMatch.Text}"`);
                    }
                } else {
                    console.log("Company customer search: no address match - filling manually");
                }
            } catch (e) {
                console.log("Company customer search failed:", e.message);
            }

            // ---- Customer As Company Information (= billing) ----
            setPlainTextBox(CJ.CompanyName,  bizName);
            setPlainTextBox(CJ.CompanyEmail, email);
            setMaskedPhone(CJ.CompanyMainPhone, phone);
            if (custAddr.street) setSearchBoxAddress(CJ.CompanyAddress, custAddr.street);
            if (custAddr.zip) {
                setPlainTextBox(CJ.CompanyZip, custAddr.zip);
                triggerZipBind(CJ.CompanyZip);
            }
            if (custAddr.city) setPlainTextBox(CJ.CompanyCity, custAddr.city);
            if (custAddr.state) {
                let stEl = document.getElementById(CJ.CompanyState);
                if (stEl) setRadComboByText(stEl, custAddr.state, true);
            }

            // Contact Person under Customer As Company (POC)
            setPlainTextBox(CJ.CCFirstName, custFirst);
            setPlainTextBox(CJ.CCLastName,  custLast);
            setMaskedPhone(CJ.CCMainPhone,  phone);
            if (email) setPlainTextBox(CJ.ContactEmail, email);

            // ---- Company Job Address Information (= loss); POC name goes HERE only ----
            if (billingSame) {
                await new Promise(r => setTimeout(r, 1000));
                let sameChk = document.getElementById(CJ.CompanyJobSameAddr);
                if (sameChk && !sameChk.checked) {
                    sameChk.click();
                    console.log("✓ Checked 'Same as Customer Company Address'");
                }
                await new Promise(r => setTimeout(r, 500));
                triggerZipBind(CJ.CompanyZipLoss);
                setPlainTextBox(CJ.CompanyLossFirstName, custFirst);
                setPlainTextBox(CJ.CompanyLossLastName,  custLast);
            } else {
                setPlainTextBox(CJ.CompanyLossFirstName, custFirst);
                setPlainTextBox(CJ.CompanyLossLastName,  custLast);
                setMaskedPhone(CJ.CompanyMainPhoneLoss, phone);
                if (lossParsed.street) setSearchBoxAddress(CJ.CompanyAddressLoss, lossParsed.street);
                if (lossParsed.zip) {
                    setPlainTextBox(CJ.CompanyZipLoss, lossParsed.zip);
                    triggerZipBind(CJ.CompanyZipLoss);
                }
                if (lossParsed.city) setPlainTextBox(CJ.CompanyCityLoss, lossParsed.city);
                if (lossParsed.state) {
                    let stEl = document.getElementById(CJ.CompanyStateLoss);
                    if (stEl) setRadComboByText(stEl, lossParsed.state, true);
                }
            }
        } else {
            // ---- RESIDENTIAL: individual customer fill ----
            setPlainTextBox(CJ.CustFirstName, custFirst);
            setPlainTextBox(CJ.CustLastName,  custLast);
            setPlainTextBox(CJ.CustEmail,     email);
            setMaskedPhone(CJ.CustMainPhone,  phone);
            if (custAddr.street) setSearchBoxAddress(CJ.CustAddress, custAddr.street);
            if (custAddr.zip) {
                setPlainTextBox(CJ.CustZip, custAddr.zip);
                triggerZipBind(CJ.CustZip);
            }
            if (custAddr.city) setPlainTextBox(CJ.CustCity, custAddr.city);
            if (custAddr.state) {
                let custStateEl = document.getElementById(CJ.CustState);
                if (custStateEl) setRadComboByText(custStateEl, custAddr.state, true);
            }

            if (billingSame) {
                await new Promise(r => setTimeout(r, 1000));
                let sameChk = document.getElementById(CJ.SameAsCustomer);
                if (sameChk && !sameChk.checked) {
                    sameChk.click();
                    console.log("✓ Checked 'Same as Customer Address' (after 1s delay)");
                }
                await new Promise(r => setTimeout(r, 500));
                triggerZipBind(CJ.LossZip);
            } else {
                setPlainTextBox(CJ.LossFirstName, custFirst);
                setPlainTextBox(CJ.LossLastName,  custLast);
                setMaskedPhone(CJ.LossMainPhone,  phone);
                if (lossParsed.street) setSearchBoxAddress(CJ.LossAddress, lossParsed.street);
                if (lossParsed.zip) {
                    setPlainTextBox(CJ.LossZip, lossParsed.zip);
                    triggerZipBind(CJ.LossZip);
                }
                if (lossParsed.city) setPlainTextBox(CJ.LossCity, lossParsed.city);
                if (lossParsed.state) {
                    let lossStateEl = document.getElementById(CJ.LossState);
                    if (lossStateEl) setRadComboByText(lossStateEl, lossParsed.state, true);
                }
            }
        }

        console.log("=== CreateJob DEBUG INFO ===");
        console.log("callerName (Job Name):", callerName);
        console.log("reportedByRaw:", reportedByRaw, "-> reportedBy:", reportedBy);
        console.log("referredByRaw:", referredByRaw, "-> referredBy:", referredBy);
        console.log("typeOfLoss:", typeOfLoss, "causeOfLoss:", causeOfLoss);
        console.log("isSelfPay:", isSelfPay, "carrier:", insuranceCarrier, "claim#:", claimNum, "policy#:", policyNum);
        console.log("scheduledPM (Estimator):", scheduledPM);

        // 1. Job Name = Company name (commercial) or POC name (residential)
        let jobName = isCommercial ? (bizName || callerName) : callerName;
        setRadTextBoxValue(CJ.JobName, jobName);

        // 2. Loss Category (Residential / Commercial) - preloaded combo
        let lossCategory = "";
        if (propertyType.toLowerCase().includes('com')) lossCategory = "Commercial";
        else if (propertyType.toLowerCase().includes('res')) lossCategory = "Residential";

        let lossCategoryEl = document.getElementById(CJ.LossCategory);
        if (lossCategoryEl && lossCategory) setRadComboByText(lossCategoryEl, lossCategory, true);

        // 3. Date of Loss
        let lossDateJS = excelDateToJSDate(parseFloat(dateOfLossRaw));
        setRadDate(CJ.DateOfLoss, lossDateJS);

// 4. Reported By / Referred By - LOAD ON DEMAND combos
        let reportedByCJ = mapReportedByCreateJob(reportedByRaw, isCommercial);
        await setLoadOnDemandCombo(CJ.ReportedBy, reportedByCJ);
        console.log("Reported By ->", reportedByCJ);

        // Referred By - contact-search combo; require EXACT text match, else "Other"
        let referredByText = mapReferredByCreateJob(referredByRaw);
        let refEl = document.getElementById(CJ.ReferredBy);
        if (referredByText && refEl) {
            let refCombo = window.$find && window.$find(CJ.ReferredBy);
            let matched = false;

            if (refCombo) {
                await new Promise((resolve) => {
                    let handler = function() {
                        let items = refCombo.get_items();
                        for (let i = 0; i < items.get_count(); i++) {
                            let item = items.getItem(i);
                            let t = (item.get_text() || "").toLowerCase().trim();
                            if (t === referredByText.toLowerCase().trim()) {   // EXACT only
                                try { item.select(); } catch (e) {}
                                setDropdownValue(refEl, item.get_value(), item.get_text(), true);
                                console.log(`✓ Referred By exact match -> "${item.get_text()}"`);
                                matched = true;
                                break;
                            }
                        }
                        refCombo.remove_itemsRequested(handler);
                        resolve();
                    };
                    refCombo.add_itemsRequested(handler);
                    try { refCombo.requestItems(referredByText, false); }
                    catch (e) { refCombo.remove_itemsRequested(handler); resolve(); }
                    setTimeout(() => { refCombo.remove_itemsRequested(handler); resolve(); }, 6000);
                });
            }

            // Known-value fallback for servpro.com (captured from live ClientState)
            if (!matched && referredByText === "servpro.com") {
                setDropdownValue(refEl, "51877:Marketing Campaign", "servpro.com", true);
                console.log("✓ Referred By set via known-value fallback (servpro.com)");
                matched = true;
            }

            // Anything unmatched -> Other
            if (!matched) {
                let ok = setRadComboByText(refEl, "Other", true);
                if (!ok) {
                    await setLoadOnDemandCombo(CJ.ReferredBy, "Other");
                }
                console.log("Referred By: no exact match - set to Other");
            }
        } else if (refEl) {
            setRadComboByText(refEl, "Other", true) || await setLoadOnDemandCombo(CJ.ReferredBy, "Other");
            console.log("Referred By: nothing mapped - set to Other");
        }

        // 5. Zip-based lookups: Office Name (preloaded) + Custom Code (load-on-demand)
        let parsedAddress = parseAddress(lossAddressRaw);
        let franchiseKey = resolveFranchise(parsedAddress.zip, parsedAddress.city, data[COLUMN.EnvironmentalCode]);
        console.log("Parsed loss address:", parsedAddress, "-> franchise:", franchiseKey);

        if (franchiseKey) {
            let group = officeGroupMap[franchiseKey];
            if (group) {
                let officeEl = document.getElementById(CJ.Office);
                if (officeEl) setRadComboByText(officeEl, `SERVPRO of ${group}`, true);
            }
            let customCodeText = customCodeMap[franchiseKey];
            if (customCodeText) {
                await setLoadOnDemandCombo(CJ.CustomCode, customCodeText);
            }
        }

        // 6. Loss Type & Secondary Loss Type - LOAD ON DEMAND, and they cascade from Loss Category,
        //    so give the page a moment after Loss Category was set before requesting items.
        let lossTypeInfo = lossTypeMap[typeOfLoss.toLowerCase().trim()] || DEFAULT_LOSS_TYPE;
        await new Promise(r => setTimeout(r, 800));
        await setLoadOnDemandCombo(CJ.LossType, lossTypeInfo.lossType);
        await new Promise(r => setTimeout(r, 500));
        await setLoadOnDemandCombo(CJ.SecondaryLossType, lossTypeInfo.secondary);

        // 7. Source of Loss - preloaded; explicit synonyms first, then word-match, then "Other"
        let sourceSynonyms = {
            "duct cleaning": "HVAC",
            "duct": "HVAC",
            "hvac": "HVAC",
            "air duct": "HVAC",
            "vent": "HVAC"
        };
        let causeLower = (causeOfLoss || "").toLowerCase().trim();
        let sourceMatch = null;
        for (let key in sourceSynonyms) {
            if (causeLower.includes(key)) { sourceMatch = sourceSynonyms[key]; break; }
        }
        if (!sourceMatch) sourceMatch = matchSourceOfLoss(causeOfLoss);   // existing generous word-matcher
        if (!sourceMatch) sourceMatch = "Other";                          // fallback
        console.log("Cause of Loss:", causeOfLoss, "-> Source of Loss:", sourceMatch);
        let sourceEl = document.getElementById(CJ.SourceOfLoss);
        if (sourceEl) {
            let ok = setRadComboByText(sourceEl, sourceMatch, true);
            if (!ok && sourceMatch !== "Other") {
                setRadComboByText(sourceEl, "Other", true);   // if HVAC/match somehow missing, try Other
            }
        }

// 8. Internal Participants: ONLY the Estimator box (= Scheduled PM). The rest cascade on their own.
if (scheduledPM !== "**NOT ASSIGNED**") {
    let estimatorMatch = await findEstimatorMatch(scheduledPM);
    if (estimatorMatch) {
        let estimatorEl = document.getElementById(CJ.Estimator);
        if (estimatorEl) {
            setDropdownValue(estimatorEl, estimatorMatch.Value, estimatorMatch.Text, true);
            console.log(`✓ Estimator: "${scheduledPM}" -> "${estimatorMatch.Text}" (${estimatorMatch.Value})`);
        }
    } else {
        console.log(`✗ No Estimator match for "${scheduledPM}"`);
    }
}

        // 9. External Participants: ONLY Insurance Carrier - "Self-Pay" or the carrier name
        let carrierTarget = isSelfPay ? "Self-Pay" : insuranceCarrier;
        if (carrierTarget) {
            let carrierOk = await setLoadOnDemandCombo(CJ.InsuranceCarrier, carrierTarget);
            if (!carrierOk && isSelfPay) {
                let carrierEl = document.getElementById(CJ.InsuranceCarrier);
                if (carrierEl) {
                    setDropdownValue(carrierEl, "1171692", "Self-Pay", true);
                    console.log("✓ Insurance Carrier set via known-value fallback (Self-Pay / 1171692)");
                }
            }
        }

        // 10. Policy Information: ONLY Claim Number + Policy Number
        if (claimNum) setRadTextBoxValue(CJ.ClaimNumber, claimNum);
        if (policyNum) setRadTextBoxValue(CJ.PolicyNumber, policyNum);

        // 11. Division checkboxes - based on Type of Loss
        let divisionLabel = divisionMap[typeOfLoss.toLowerCase().trim()] || DEFAULT_DIVISION;
        let divCheckboxId = DIVISION_CHECKBOXES[divisionLabel];
        let divCheckbox = divCheckboxId ? document.getElementById(divCheckboxId) : null;
        if (divCheckbox && !divCheckbox.checked) {
            divCheckbox.click();
            console.log("✓ Division checked:", divisionLabel);
        }

        // 12. Loss Description = same as WorkCenter Project Notes (journalNote)
        let prefix = propertyType ? propertyType.substring(0,3).toUpperCase() : "";
        let lossDescription = prefix && typeOfLoss ? `${prefix}/${typeOfLoss}` : (prefix || typeOfLoss || "");
        let descEl = document.getElementById(CJ.LossDescription);
        if (descEl) {
            descEl.value = lossDescription;
            descEl.dispatchEvent(new Event('input', { bubbles: true }));
            descEl.dispatchEvent(new Event('change', { bubbles: true }));
            // Telerik RadInput textarea also tracks state via $find
            let tb = window.$find && window.$find(CJ.LossDescription);
            if (tb && tb.set_value) { try { tb.set_value(lossDescription); } catch (e) {} }
            console.log("✓ Loss Description filled");
        }

        // NOTE: Payment Services section intentionally untouched.
        console.log("=== CreateJob autofill complete ===");
    }

    // ==========================================
    //  BUTTON CLICK -> ROUTE BY PAGE
    // ==========================================
    btn.addEventListener('click', async function() {
        const rawData = inputBox.value.trim();
        if (!rawData) { alert('Please paste the data key.'); return; }
        const data = rawData.split('|||').map(x => x.trim());

        if (location.pathname.toLowerCase().includes('/createjob.aspx')) {
            await autofillCreateJob(data);
        } else {
            autofillWorkCenter(data);
        }
    });
})();
