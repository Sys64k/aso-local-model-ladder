// Quick verification
const text = Array.from({ length: 200_000 }, () => "x").join("");
console.log("Text length:", text.length);
console.log("Max characters:", 200_000);
console.log("Match:", text.length === 200_000);