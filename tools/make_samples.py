"""Generate the demo resume files in assets/samples/.

    python tools/make_samples.py

- priya_sharma_two_column.pdf : sidebar layout, the case that breaks naive extraction
- rahul_verma.docx            : Word document with bullet lists
- aisha_khan.pdf              : plain single column
"""

from pathlib import Path

from docx import Document
from docx.shared import Pt
from reportlab.lib.colors import HexColor
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas

OUT = Path(__file__).resolve().parent.parent / "assets" / "samples"
OUT.mkdir(parents=True, exist_ok=True)

TEAL = HexColor("#0f766e")
GREY = HexColor("#4b5563")


def wrap(c, text, x, y, width, font="Helvetica", size=9.5, leading=13):
    words = text.split()
    line = ""
    for w in words:
        trial = (line + " " + w).strip()
        if c.stringWidth(trial, font, size) > width:
            c.drawString(x, y, line)
            y -= leading
            line = w
        else:
            line = trial
    if line:
        c.drawString(x, y, line)
        y -= leading
    return y


def two_column_pdf():
    path = OUT / "priya_sharma_two_column.pdf"
    c = canvas.Canvas(str(path), pagesize=A4)
    W, H = A4
    side_w = 170

    c.setFillColor(HexColor("#f1f5f4"))
    c.rect(0, 0, side_w + 20, H, stroke=0, fill=1)

    # sidebar
    x = 24
    y = H - 50
    c.setFillColor(TEAL)
    c.setFont("Helvetica-Bold", 18)
    c.drawString(x, y, "PRIYA SHARMA")
    y -= 18
    c.setFont("Helvetica", 9)
    c.setFillColor(GREY)
    for line in ["Pune, Maharashtra", "priya.sharma.ds@gmail.com", "+91 98220 11234", "linkedin.com/in/priya-sharma-ds"]:
        c.drawString(x, y, line)
        y -= 13

    def side_header(title, y):
        c.setFillColor(TEAL)
        c.setFont("Helvetica-Bold", 11)
        c.drawString(x, y, title)
        c.setFillColor(HexColor("#111827"))
        c.setFont("Helvetica", 9.5)
        return y - 16

    y -= 18
    y = side_header("SKILLS", y)
    for s in ["Python", "PyTorch", "Transformers", "spaCy", "NLP", "SQL", "GCP", "Docker", "Airflow", "Statistics", "Git"]:
        c.drawString(x, y, s)
        y -= 13

    y -= 12
    y = side_header("EDUCATION", y)
    for line in ["M.Tech, Computer Science", "COEP Pune, 2018", "", "B.E., Information Technology", "Pune University, 2016"]:
        if line:
            c.drawString(x, y, line)
        y -= 13

    # hidden keyword stuffing, 1pt white text - extraction should drop it
    c.setFillColor(HexColor("#ffffff"))
    c.setFont("Helvetica", 1)
    c.drawString(x, 40, "AWS Kubernetes Spark MLOps SageMaker AWS AWS AWS")

    # main column
    mx = side_w + 50
    mw = W - mx - 36
    y = H - 50

    def main_header(title, y):
        c.setFillColor(TEAL)
        c.setFont("Helvetica-Bold", 12)
        c.drawString(mx, y, title)
        c.setFillColor(HexColor("#111827"))
        return y - 18

    y = main_header("SUMMARY", y)
    c.setFont("Helvetica", 9.5)
    y = wrap(c, "Data scientist with 8 years of experience building NLP and search systems. "
                "Comfortable taking a model from notebook to production.", mx, y, mw)
    y -= 12

    y = main_header("EXPERIENCE", y)
    jobs = [
        ("Senior Data Scientist | Persistent Systems | Jan 2021 - Present", [
            "Built a BERT-based named entity recognition model for contract documents, raising F1 from 0.71 to 0.89",
            "Designed a semantic search service on Google Cloud (Vertex AI, BigQuery) serving 2M queries per month",
            "Reduced inference latency by 45% by distilling the model and moving to ONNX runtime",
            "Mentored 3 junior data scientists and ran the team's weekly paper reading group",
        ]),
        ("Data Scientist | Fractal Analytics | Jul 2018 - Dec 2020", [
            "Developed churn prediction models in Python and scikit-learn for a telecom client with 12M subscribers",
            "Automated feature pipelines with Airflow and SQL, cutting report turnaround from 3 days to 4 hours",
            "Ran A/B tests and statistical analysis for pricing experiments",
        ]),
    ]
    for head, bullets in jobs:
        c.setFont("Helvetica-Bold", 10)
        c.drawString(mx, y, head)
        y -= 15
        c.setFont("Helvetica", 9.5)
        for b in bullets:
            c.drawString(mx, y, "•")
            y = wrap(c, b, mx + 10, y, mw - 10)
        y -= 8

    c.showPage()
    c.save()
    return path


def single_column_pdf():
    path = OUT / "aisha_khan.pdf"
    c = canvas.Canvas(str(path), pagesize=A4)
    W, H = A4
    x, y = 56, H - 60
    c.setFont("Helvetica-Bold", 18)
    c.drawString(x, y, "Aisha Khan")
    y -= 18
    c.setFont("Helvetica", 9.5)
    c.drawString(x, y, "Mumbai | aisha.khan@yahoo.in | +91-9930012345")
    y -= 28

    sections = [
        ("OBJECTIVE", ["Data analyst looking to move into data science."]),
        ("EXPERIENCE", [
            "Data Analyst - Tata Consultancy Services | Aug 2022 - Present",
            "• Built Tableau and Power BI dashboards used by 60+ regional managers",
            "• Wrote SQL queries to clean and join sales data from 3 source systems",
            "• Automated a weekly Excel report with Python and pandas, saving 6 hours a week",
        ]),
        ("EDUCATION", ["B.Sc. Statistics, St. Xavier's College Mumbai, 2022"]),
        ("SKILLS", ["SQL, Excel, Tableau, Power BI, Python, Pandas, Statistics"]),
    ]
    for title, lines in sections:
        c.setFont("Helvetica-Bold", 12)
        c.drawString(x, y, title)
        y -= 17
        c.setFont("Helvetica", 9.5)
        for line in lines:
            y = wrap(c, line, x, y, W - 2 * x)
        y -= 12
    c.showPage()
    c.save()
    return path


def docx_resume():
    path = OUT / "rahul_verma.docx"
    doc = Document()
    style = doc.styles["Normal"]
    style.font.name = "Calibri"
    style.font.size = Pt(10.5)

    doc.add_heading("Rahul Verma", level=0)
    doc.add_paragraph("Bengaluru | rahul.verma@outlook.com | 9845012345 | github.com/rverma-ml")

    doc.add_heading("Professional Summary", level=1)
    doc.add_paragraph("Machine learning engineer, 9 years across e-commerce and fintech. I like boring, reliable ML systems.")

    doc.add_heading("Work Experience", level=1)
    doc.add_paragraph("Lead ML Engineer, Flipkart (Mar 2020 - Present)")
    for b in [
        "Led a team of 5 building product search ranking; improved click-through rate by 18%",
        "Migrated training pipelines to AWS SageMaker and Spark on EMR, saving 30% compute cost",
        "Deployed models with Docker and Kubernetes (EKS), handling 15k requests per second at peak",
        "Built text classification models in TensorFlow for catalogue tagging across 40M products",
    ]:
        doc.add_paragraph(b, style="List Bullet")

    doc.add_paragraph("Machine Learning Engineer, Razorpay (Jun 2017 - Feb 2020)")
    for b in [
        "Built fraud detection models with XGBoost and Python, reducing chargebacks by 22%",
        "Wrote SQL and PySpark jobs for feature engineering over 2B transactions",
        "Set up MLflow for experiment tracking for the whole data team",
    ]:
        doc.add_paragraph(b, style="List Bullet")

    doc.add_heading("Education", level=1)
    doc.add_paragraph("B.Tech in Computer Science, NIT Trichy, 2017 - CGPA 8.4/10")

    doc.add_heading("Technical Skills", level=1)
    doc.add_paragraph("Python | TensorFlow | PyTorch | XGBoost | AWS | Spark | Docker | Kubernetes | SQL | MLflow | NLP")
    doc.save(path)
    return path


if __name__ == "__main__":
    for fn in (two_column_pdf, single_column_pdf, docx_resume):
        print("wrote", fn().relative_to(OUT.parent.parent))
