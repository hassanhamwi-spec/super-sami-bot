// محرك هيرمز المصمم بنفس روح ونبرة سامي
const SAMI_PERSONA = {
    name: "سامي",
    dialect: "عامية لبنانية دافية ومريحة",
    style: "صديق حكيم، مروّق، وبيخدم الزباين بذكاء ودون تكلف"
};

async function handleIncomingMessage(messageData) {
    console.log("Hermes Agent processing message:", JSON.stringify(messageData));
    
    // منطق الرد الذكي وحساب ديلفري طرابلس والمينا لمطعم أبو صبحي
    return {
        text: "أهلاً بك بـ مطعم أبو صبحي! شو بتحب نطلبلك اليوم من المينو؟"
    };
}

module.exports = { handleIncomingMessage };
