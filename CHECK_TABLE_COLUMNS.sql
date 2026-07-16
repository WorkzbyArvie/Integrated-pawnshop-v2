-- Check staff table structure
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_schema = 'public' 
AND table_name = 'staff'
ORDER BY ordinal_position;

-- Also check branch table to understand relationships
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_schema = 'public' 
AND table_name = 'branch'
ORDER BY ordinal_position;
