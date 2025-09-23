# Database Schema Export to JSON

## 📌 Overview  
This project connects to a PostgreSQL database, inspects tables and their relationships, and generates a **JSON schema** starting from a given table.  

The JSON structure mimics nested relationships defined by foreign keys, making it useful for:  
- Data documentation  
- Schema visualization  
- Preparing empty templates for ingestion or testing  

---

## ✅ Current Progress  

### Implemented
- **Database Connection** using SQLAlchemy  
- **Recursive Traversal** of tables via foreign keys  
- **Schema Extraction**: starting from a primary table and walking through related tables  
- **Empty JSON Structure Generation**: schema with nested objects, all fields left empty `{}`  
- **Manual Schema Cleaning**: commented fields removed → strict depopulated schema  

### Example Output (simplified)
```json
{
  "_table": "master_inprocessinspectionreading",
  "id": {},
  "created_at": {},
  "actual_readings": [
    { "accepted": {}, "rejected": {} }
  ],
  "created_by_id": {
    "first_name": {},
    "email": {},
    "role_id": {
      "id": {},
      "name": {}
    }
  }
}
