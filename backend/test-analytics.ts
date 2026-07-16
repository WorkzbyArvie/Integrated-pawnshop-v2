const pawnshopId = '7e1a7edd-1fb8-4cde-9b3b-df6c46d9fa15';
const url = `http://localhost:3000/analytics/branch/${pawnshopId}`;

console.log('🔍 Testing analytics endpoint:', url);

fetch(url)
  .then(async (res) => {
    if (!res.ok) {
      console.error('❌ Error:', res.status, res.statusText);
      const text = await res.text();
      console.error('Response:', text);
      return;
    }
    const data = await res.json();
    console.log('✅ Response received:');
    console.log(JSON.stringify(data, null, 2));
  })
  .catch(error => {
    console.error('❌ Fetch error:', error.message);
  });
