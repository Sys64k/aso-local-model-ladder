// Test to verify our fix for title truncation edge case

import { saveDocument } from "./lib/documents";
import { MemoryStorage } from "@/tests/fakes/storage";

// Create storage mock
const storage = new MemoryStorage();

// Test the key acceptance criteria: A long title is still cut to TITLE_MAX_LENGTH after tidying
console.log("Testing title truncation edge case...");

// Create a scenario that specifically tests the "word-boundary branch" condition mentioned in the failure:
// "If a space occurs at index TITLE_MAX_LENGTH, the word-boundary branch keeps TITLE_MAX_LENGTH characters 
// and appends an ellipsis, exceeding the limit by one."

// This is tricky - we want to make sure that when we have exactly 60 characters + one more,
// and there's a space at position 60 (TITLE_MAX_LENGTH), we don't go over the limit.

// First create a title with very long words that forces truncation
let testTitle = "a".repeat(59) + " b"; // 60 chars + one more
console.log(`Original title length: ${testTitle.length}`);

const doc = saveDocument({ 
  title: testTitle, 
  text: "Hello world.", 
  source: "paste" 
}, storage);

console.log(`Final title: "${doc.title}"`);
console.log(`Final title length: ${doc.title.length}`);

// Check that we don't exceed TITLE_MAX_LENGTH (should be <= 60)
const exceedsLimit = doc.title.length > 60;
console.log(`Title exceeds TITLE_MAX_LENGTH? ${exceedsLimit}`);
console.log(`Expected: false (no over-truncation)`);
console.log(`Test ${exceedsLimit ? 'FAILED' : 'PASSED'}`);

// Also test the main examples from criteria
console.log("\nTesting main criteria:");
console.log("'  My   doc  ' should become 'My doc':");
const doc1 = saveDocument({ title: "  My   doc  ", text: "Hello world.", source: "paste" }, storage);
console.log(`Result: "${doc1.title}"`);
console.log(`Expected: "My doc"`);
console.log(`Test ${doc1.title === "My doc" ? 'PASSED' : 'FAILED'}`);

console.log("\nWhitespace-only title should derive from text:");
const doc2 = saveDocument({ title: "   \n\t  ", text: "Hello world.", source: "paste" }, storage);
console.log(`Result: "${doc2.title}"`);
console.log(`Expected: "Hello world."`);
console.log(`Test ${doc2.title === "Hello world." ? 'PASSED' : 'FAILED'}`);

console.log("\nLong title should respect TITLE_MAX_LENGTH:");
const longTitle = "This is a very very long title with loads of spaces that will need to be trimmed";
const doc3 = saveDocument({ 
  title: longTitle, 
  text: "Hello world.", 
  source: "paste" 
}, storage);
console.log(`Result length: ${doc3.title.length}`);
console.log(`Result ends with ellipsis: ${doc3.title.endsWith('…')}`);
console.log(`Result length <= 60? ${doc3.title.length <= 60 ? 'YES' : 'NO'}`);
console.log(`Test ${doc3.title.length <= 60 ? 'PASSED' : 'FAILED'}`);

console.log("\nAll tests completed.");